import localforage from "localforage";
import type { ModelRef } from "../upstream/packages/drawnix/src/utils/settings-manager";
import { waitForEcommerceRequest } from "./ecommerce-request";

export type EcommerceVideoJob = {
  version: 1;
  id: string;
  tool: string;
  owner: string | null;
  createdAt: number;
  modelRef: ModelRef;
  prompt: string;
  size: string;
  seconds: string;
  aspectRatio: string;
  /** Optional for legacy records. Only model parameters, never provider credentials. */
  generationParams?: Record<string, string>;
  batchId?: string;
  label?: string;
  references?: File[];
  referenceVideo?: File;
  taskId?: string;
  resultUrl?: string;
  video?: Blob;
  status: "pending" | "waiting" | "complete" | "interrupted";
  error?: string;
};
type Storage = {
  keys(): Promise<string[]>;
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
};
export type VideoExecutor = {
  generate(
    job: EcommerceVideoJob,
    signal: AbortSignal,
    submitted: (id: string) => Promise<void>,
    progress: (value: number) => void,
  ): Promise<string>;
  download(url: string, signal: AbortSignal): Promise<Blob>;
};

/** Media and task IDs only; provider credentials are resolved in memory. */
export class EcommerceVideoStore {
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private loading?: Promise<void>;
  private stopQueue = false;
  private writes: Promise<unknown> = Promise.resolve();
  private state = {
    ready: false,
    jobs: [] as EcommerceVideoJob[],
    activeId: "",
    progress: 0,
    storageError: "",
  };
  constructor(
    private storage: Storage,
    private timeoutMs = 90 * 60 * 1000,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.state = { ...this.state, jobs: [...this.state.jobs] };
    this.listeners.forEach((fn) => fn());
  }
  async load() {
    return (this.loading ||= (async () => {
      try {
        const values = await Promise.all(
          (await this.storage.keys()).map((key) =>
            this.storage.getItem<EcommerceVideoJob>(key),
          ),
        );
        this.state.jobs = values
          .filter((job): job is EcommerceVideoJob => job?.version === 1)
          .map((job) =>
            job.status === "waiting"
              ? {
                  ...job,
                  status: "interrupted" as const,
                  error: "应用曾中断，可继续查询已有任务，不会重新计费生成。",
                }
              : job,
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        this.state.ready = true;
      } catch {
        this.state.storageError =
          "无法读取视频记录，已阻止生成，请检查本地存储。";
      }
      this.emit();
    })());
  }
  private async save(job: EcommerceVideoJob) {
    const snapshot = structuredClone(job);
    const write = this.writes
      .catch(() => {})
      .then(() => this.storage.setItem(job.id, snapshot));
    this.writes = write;
    try {
      await write;
      this.state.storageError = "";
    } catch {
      this.state.storageError =
        "视频记录保存失败，请保留当前窗口并释放磁盘空间。";
      this.emit();
      throw new Error(this.state.storageError);
    }
  }
  async start(
    input: Omit<EcommerceVideoJob, "version" | "id" | "createdAt" | "status">,
    executor: VideoExecutor,
    count = 1,
  ) {
    await this.load();
    if (!this.state.ready) throw new Error(this.state.storageError);
    if (this.state.activeId) throw new Error("已有视频任务正在执行。");
    if (!Number.isInteger(count) || count < 1 || count > 4)
      throw new Error("请选择 1–4 条视频。");
    const batchId = crypto.randomUUID();
    const jobs: EcommerceVideoJob[] = Array.from({ length: count }, (_, i) => ({
      ...input,
      modelRef: { ...input.modelRef },
      generationParams: input.generationParams
        ? { ...input.generationParams }
        : undefined,
      references: input.references ? [...input.references] : undefined,
      version: 1,
      id: crypto.randomUUID(),
      batchId,
      label: `方案 ${i + 1}/${count}`,
      prompt:
        count > 1
          ? `${input.prompt}。这是同组第 ${i + 1}/${count} 条独立视频，保持商品一致，在允许的创作范围内形成不同方案。`
          : input.prompt,
      createdAt: Date.now(),
      status: "pending",
    }));
    this.stopQueue = false;
    this.state.activeId = jobs[0].id;
    this.state.jobs.unshift(...jobs);
    this.emit();
    try {
      for (const job of jobs) await this.save(job);
    } catch (error) {
      this.state.activeId = "";
      this.emit();
      throw error;
    }
    void this.runQueue(jobs, executor);
    return jobs[0].id;
  }
  async resume(id: string, owner: string | null, executor: VideoExecutor) {
    if (this.state.activeId) throw new Error("已有视频任务正在执行。");
    const job = this.state.jobs.find((job) => job.id === id);
    if (!job || job.owner !== owner)
      throw new Error("请切回创建视频时使用的账户。");
    if (job.status !== "pending" && !job.taskId && !job.resultUrl && !job.video)
      throw new Error("未取得任务编号，请先核对调用记录。不会自动重发请求。");
    this.stopQueue = false;
    const pending = job.batchId
      ? this.state.jobs.filter(
          (j) =>
            j.id !== job.id &&
            j.batchId === job.batchId &&
            j.status === "pending",
        )
      : [];
    void this.runQueue([job, ...pending], executor);
  }
  pause() {
    this.stopQueue = true;
    this.controller?.abort(
      new Error("已停止等待，服务端可能仍在生成；可继续查询原任务。"),
    );
  }
  private async runQueue(jobs: EcommerceVideoJob[], executor: VideoExecutor) {
    try {
      for (const job of jobs) {
        if (this.stopQueue) break;
        await this.run(job, executor);
        if (job.status !== "complete") break;
      }
    } finally {
      this.state.activeId = "";
      this.emit();
    }
  }
  private async run(job: EcommerceVideoJob, executor: VideoExecutor) {
    const controller = new AbortController();
    this.controller = controller;
    this.state.activeId = job.id;
    this.state.progress = 0;
    job.status = "waiting";
    job.error = undefined;
    this.emit();
    const timer = setTimeout(
      () => controller.abort(new Error("视频等待超时，可继续查询原任务。")),
      this.timeoutMs,
    );
    const signal = controller.signal;
    try {
      await this.save(job);
      signal.throwIfAborted();
      if (!job.resultUrl && !job.video) {
        job.resultUrl = await waitForEcommerceRequest(
          executor.generate(
            job,
            signal,
            async (taskId) => {
              // Submission may finish after stopping the wait. Keep its ID anyway.
              job.taskId = taskId;
              await this.save(job);
              this.emit();
            },
            (progress) => {
              if (!signal.aborted) {
                this.state.progress = Math.max(0, Math.min(99, progress));
                this.emit();
              }
            },
          ),
          signal,
        );
        await this.save(job);
      }
      signal.throwIfAborted();
      if (!job.video)
        job.video = await waitForEcommerceRequest(
          executor.download(job.resultUrl!, signal),
          signal,
        );
      signal.throwIfAborted();
      await this.save({ ...job, status: "complete", resultUrl: undefined });
      job.status = "complete";
      job.resultUrl = undefined;
      this.state.progress = 100;
    } catch (cause) {
      job.status = "interrupted";
      job.error =
        cause instanceof Error ? cause.message : "视频生成或保存失败。";
      await this.save(job).catch(() => {});
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
      this.emit();
    }
  }
}

export const ecommerceVideos = new EcommerceVideoStore(
  localforage.createInstance({
    name: "tuzi-ecommerce-videos",
    storeName: "jobs",
  }),
);
