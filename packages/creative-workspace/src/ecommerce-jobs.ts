import localforage from "localforage";

const boundedOutputCount = (value: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(4, Math.floor(value))) : 1;

export const ECOMMERCE_ITEM_TIMEOUT_MS = 10 * 60 * 1000;
export type ImageStage =
  | "preparing"
  | "submitting"
  | "sending"
  | "receiving"
  | "saving";
export type ImageStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "unknown";
export type ImageAttempt = {
  requestId: string;
  startedAt: number;
  endedAt?: number;
  stage: ImageStage;
  httpStatus?: number;
  upstreamId?: string;
  taskId?: string;
};
export type EcommerceItem = {
  id: string;
  label: string;
  prompt: string;
  status: ImageStatus;
  attempts: ImageAttempt[];
  image?: Blob;
  // Retained if downloading a generated result fails; retrying its download
  // must never resubmit the paid model request.
  resultUrl?: string;
  error?: string;
};
export type EcommerceBatch = {
  version: 1;
  id: string;
  createdAt: number;
  title: string;
  tool: string;
  // Persist only the route identity, independent of runtime provider settings.
  modelRef: { profileId: string | null; modelId: string | null };
  owner: string | null;
  size: string;
  references: File[];
  /** Optional additions preserve readable v1 history. Legacy references have no inferred roles. */
  referenceRoles?: Array<"product" | "style">;
  generationParams?: Record<string, string>;
  items: EcommerceItem[];
};
export type ImageProgress = Partial<
  Pick<ImageAttempt, "httpStatus" | "upstreamId" | "taskId">
> & { stage: ImageStage };
export type BatchExecutor = {
  generate: (
    batch: EcommerceBatch,
    item: EcommerceItem,
    signal: AbortSignal,
    report: (progress: ImageProgress) => Promise<void>,
  ) => Promise<string>;
  download: (url: string, signal: AbortSignal) => Promise<Blob>;
};
type Storage = {
  keys(): Promise<string[]>;
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
};
export const imageStageLabels: Record<ImageStage, string> = {
  preparing: "准备素材",
  submitting: "准备提交请求",
  sending: "正在发送 · 等待服务端响应",
  receiving: "已收到服务端响应 · 读取结果",
  saving: "保存图片到本机",
};

export function planEcommerceImages(input: {
  tool: string;
  structure: string;
  labels: string[];
  apparelTypes: string[];
  counts: Record<string, number>;
  prompt: string;
  outputMode?: "combined" | "separate";
  outputCount?: number;
  perOutputCounts?: Record<string, number>;
}): Array<{ label: string; prompt: string }> {
  let labels: string[];
  if (input.tool === "product-set" && input.structure === "custom") {
    labels = Object.entries({
      whiteBackground: "白底图",
      scene: "场景图",
      sellingPoint: "卖点图",
      other: "其他商品图",
    }).flatMap(([key, label]) =>
      Array.from(
        {
          length: Math.max(0, Math.min(12, Math.floor(input.counts[key] || 0))),
        },
        (_, i) => `${label} ${i + 1}`,
      ),
    );
  } else if (input.tool === "product-set" || input.tool === "detail-page") {
    labels = [...new Set(input.labels)];
    if (input.tool === "detail-page" && !labels.includes("首屏主视觉"))
      labels.unshift("首屏主视觉");
    if (!labels.length) labels.push("首图主视觉");
  } else if (input.tool === "apparel-set") {
    labels = input.apparelTypes.length ? input.apparelTypes : ["白底精修图"];
  } else if (input.outputMode === "separate") {
    labels = [
      ...new Set(
        input.labels.filter(
          (label) => !["平台规范适配", "生成多种变体"].includes(label),
        ),
      ),
    ];
    if (!labels.length) labels = ["商品图片"];
  } else labels = ["商品图片"];
  // Custom module counts are already expanded, never multiply them again.
  if (!(input.tool === "product-set" && input.structure === "custom")) {
    labels = labels.flatMap((label) => {
      const count = boundedOutputCount(
        input.perOutputCounts?.[label] ?? input.outputCount ?? 1,
      );
      return Array.from({ length: count }, (_, index) =>
        count === 1 ? label : `${label} · 方案 ${index + 1}`,
      );
    });
  }
  return labels.map((label, i) => ({
    label,
    prompt: `${input.prompt}。本次仅生成一张独立的「${label}」，这是整套第 ${i + 1}/${labels.length} 张。只呈现此模块，不要把整套内容拼接到一张图，不要绘制缩略图列表或编号。保持参考商品的形状、颜色、标识和材质一致，各张保持同一视觉风格。商品事实约束：仅使用用户明确提供的商品事实和原图可见的外观信息。不得推断内衬、鞋底底面等不可见结构，不得虚构材质成分、尺寸、耐用性、舒适度、功效、认证、质保或赠品；缺少依据时省略对应文案、图标和特写。没有明确要求时不得改变商品颜色、数量或磨损状态。${label.includes("对比") ? "对比图专项约束：没有提供真实前后素材和效果依据时，只展示原图中已有颜色或角度的中性并列展示，不使用 Before/After、优劣、改善、升级等暗示，不得把任何一款商品画旧、损坏或贬低。" : ""}${label.includes("角度") ? "多角度图不得凭空设计不可见的底纹、标识或内部结构，只展示有参考依据的视角。" : ""}`,
  }));
}

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Owns work independently of React mounts. Never persists credentials or replays on load. */
export class EcommerceJobStore {
  private batches: EcommerceBatch[] = [];
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private active?: {
    batchId: string;
    controller?: AbortController;
    stopped: boolean;
  };
  private writes: Promise<unknown> = Promise.resolve();
  private snapshot = {
    batches: this.batches,
    activeId: "",
    ready: false,
    storageError: "",
  };
  constructor(
    private storage: Storage,
    private timeoutMs = ECOMMERCE_ITEM_TIMEOUT_MS,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.snapshot = {
      ...this.snapshot,
      batches: [...this.batches],
      activeId: this.active?.batchId || "",
    };
    this.listeners.forEach((listener) => listener());
  }
  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const records = await Promise.all(
          (await this.storage.keys())
            .filter((k) => k.startsWith("batch:"))
            .map((k) => this.storage.getItem<EcommerceBatch>(k)),
        );
        this.batches = records
          .filter((record): record is EcommerceBatch =>
            Boolean(record?.version === 1 && Array.isArray(record.items)),
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        for (const batch of this.batches) {
          for (const item of batch.items)
            if (item.status === "running") {
              item.status = "unknown";
              item.error =
                "应用曾中断；请求结果待核对。已有图片已保留，未自动重新提交。";
            }
        }
        this.snapshot.ready = true;
      } catch {
        this.snapshot.storageError =
          "无法读取本地任务记录，已阻止生成。请检查磁盘空间后重新打开。";
      }
      this.emit();
    })();
    return this.loading;
  }
  private async save(batch: EcommerceBatch) {
    // Serialize writes, snapshot before awaiting, so late stage updates cannot
    // overwrite a newer successful result on disk.
    const snapshot = structuredClone(batch);
    const write = this.writes
      .catch(() => {})
      .then(() => this.storage.setItem(`batch:${batch.id}`, snapshot));
    this.writes = write;
    try {
      await write;
      this.snapshot.storageError = "";
    } catch {
      this.snapshot.storageError =
        "本地保存失败，已暂停后续生成。请释放磁盘空间，并保留此窗口中的图片。";
      this.emit();
      throw new Error("ecommerce_storage_failed");
    }
  }
  async start(
    input: Omit<EcommerceBatch, "id" | "version" | "createdAt" | "items"> & {
      items: Array<{ label: string; prompt: string }>;
    },
    executor: BatchExecutor,
  ) {
    await this.load();
    if (!this.snapshot.ready) throw new Error(this.snapshot.storageError);
    if (this.active) throw new Error("已有生图任务正在执行，请先等待或暂停。");
    if (!input.items.length || input.items.length > 48)
      throw new Error("请选择 1–48 张图片。");
    const batch: EcommerceBatch = {
      ...input,
      id: crypto.randomUUID(),
      version: 1,
      createdAt: Date.now(),
      items: input.items.map((item) => ({
        ...item,
        id: crypto.randomUUID(),
        status: "pending",
        attempts: [],
      })),
    };
    this.batches.unshift(batch);
    // run reserves synchronously before its first await.
    void this.run(
      batch,
      batch.items.map((item) => item.id),
      executor,
    );
    return batch.id;
  }
  async resume(
    id: string,
    executor: BatchExecutor,
    owner: string | null,
    itemId?: string,
  ) {
    if (this.active) throw new Error("已有生图任务正在执行。");
    const batch = this.batches.find((b) => b.id === id);
    if (!batch || batch.owner !== owner)
      throw new Error("请切回创建此任务时使用的账户。");
    const items = batch.items.filter((item) =>
      itemId
        ? item.id === itemId && item.status !== "complete"
        : item.status === "pending",
    );
    if (!items.length) return;
    void this.run(
      batch,
      items.map((item) => item.id),
      executor,
    );
  }
  pause() {
    if (!this.active) return;
    this.active.stopped = true;
    this.active.controller?.abort(new Error("ecommerce_paused"));
  }
  private async run(
    batch: EcommerceBatch,
    ids: string[],
    executor: BatchExecutor,
  ) {
    const active = {
      batchId: batch.id,
      stopped: false,
      controller: undefined as AbortController | undefined,
    };
    this.active = active;
    this.emit();
    try {
      await this.save(batch); // Durable intent before any paid request.
      for (const id of ids) {
        if (active.stopped) break;
        const item = batch.items.find((item) => item.id === id)!;
        if (item.status === "complete") continue;
        const controller = new AbortController();
        active.controller = controller;
        const { signal } = controller;
        // A downloaded/persist-failed result is retried locally, never billed again.
        if (!item.resultUrl && !item.image)
          item.attempts.push({
            requestId: crypto.randomUUID(),
            startedAt: Date.now(),
            stage: "preparing",
          });
        const attempt = item.attempts.at(-1)!;
        item.status = "running";
        item.error = undefined;
        this.emit();
        const timer = setTimeout(
          () => controller.abort(new Error("ecommerce_timeout")),
          this.timeoutMs,
        );
        const report = async (progress: ImageProgress) => {
          if (signal.aborted || item.status !== "running") return;
          Object.assign(attempt, progress);
          this.emit();
          await this.save(batch);
        };
        try {
          await this.save(batch);
          signal.throwIfAborted();
          if (!item.resultUrl && !item.image) {
            const result = await bounded(
              executor.generate(batch, item, signal, report),
              signal,
            );
            signal.throwIfAborted();
            item.resultUrl = result;
            await report({ stage: "saving" });
          }
          if (!item.image)
            item.image = await bounded(
              executor.download(item.resultUrl!, signal),
              signal,
            );
          signal.throwIfAborted();
          attempt.endedAt = Date.now();
          // Only advertise "saved" once the completed snapshot is durable.
          // Keep the in-memory Blob on quota errors so saving can be retried
          // without generating (or charging for) the image again.
          await this.save({
            ...batch,
            items: batch.items.map((current) =>
              current.id === item.id
                ? { ...current, status: "complete", resultUrl: undefined }
                : current,
            ),
          });
          item.status = "complete";
          item.resultUrl = undefined;
          this.emit();
        } catch (error) {
          {
            const rejected =
              attempt.httpStatus !== undefined &&
              attempt.httpStatus >= 400 &&
              attempt.httpStatus < 500;
            item.status =
              rejected || attempt.stage === "preparing" ? "failed" : "unknown";
            item.error =
              item.resultUrl || item.image
                ? "模型已返回图片，但本地保存未完成。请重试保存，不会重新生图。"
                : signal.reason?.message === "ecommerce_timeout"
                  ? "单张等待已达 10 分钟，结果待核对；服务端可能仍在处理。"
                  : signal.aborted
                    ? "已暂停，当前请求结果待核对；后续图片尚未发送。"
                    : rejected
                      ? `服务端返回 HTTP ${attempt.httpStatus}，请检查模型配置后重试这一张。`
                      : "生成未完成，请核对调用记录和模型配置后再重试这一张。";
            attempt.endedAt = Date.now();
          }
          this.emit();
          await this.save(batch).catch(() => {});
          break; // No automatic retry or cascade of paid failures.
        } finally {
          clearTimeout(timer);
        }
      }
    } catch {
      /* save() exposes storage errors; no request was issued. */
    } finally {
      this.active = undefined;
      this.emit();
    }
  }
}

export const ecommerceJobs = new EcommerceJobStore(
  localforage.createInstance({
    name: "tuzi-ecommerce",
    storeName: "batches_v1",
    driver: localforage.INDEXEDDB,
  }),
);
