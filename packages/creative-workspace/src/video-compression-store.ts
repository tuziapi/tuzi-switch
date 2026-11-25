import localforage from "localforage";
import type { CreativeAccountBridge } from "./bridge-types";

export type CompressionOptions = Parameters<
  NonNullable<CreativeAccountBridge["compressVideo"]>
>[1];
export type CompressionRecord = {
  version: 1;
  id: string;
  createdAt: number;
  name: string;
  originalBytes: number;
  duration: number;
  options: CompressionOptions;
  status: "running" | "complete" | "interrupted";
  video?: Blob;
  error?: string;
};
type Storage = Pick<LocalForage, "keys" | "getItem" | "setItem">;
export class VideoCompressionStore {
  private state = {
    ready: false,
    activeId: "",
    seconds: 0,
    records: [] as CompressionRecord[],
    storageError: "",
  };
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private controller?: AbortController;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(private storage: Storage) {}
  private emit() {
    this.state = { ...this.state, records: [...this.state.records] };
    this.listeners.forEach((fn) => fn());
  }
  load() {
    return (this.loading ||= (async () => {
      try {
        const records = await Promise.all(
          (await this.storage.keys()).map((key) =>
            this.storage.getItem<CompressionRecord>(key),
          ),
        );
        this.state.records = records
          .filter((r): r is CompressionRecord => r?.version === 1)
          .map((record) =>
            record.status === "running"
              ? {
                  ...record,
                  status: "interrupted" as const,
                  error: "上次压缩已中断，请重新选择原视频。原视频未改动。",
                }
              : record,
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        this.state.ready = true;
      } catch {
        this.state.storageError = "无法读取压缩记录，请检查本地存储。";
      }
      this.emit();
    })());
  }
  cancel() {
    this.controller?.abort();
  }
  async start(
    file: File,
    duration: number,
    options: CompressionOptions,
    compress: NonNullable<CreativeAccountBridge["compressVideo"]>,
  ) {
    await this.load();
    if (!this.state.ready) throw new Error(this.state.storageError);
    if (this.state.activeId) throw new Error("已有视频正在压缩。");
    if (
      !file.size ||
      file.size > 128 * 1024 * 1024 ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      throw new Error("请选择 128 MB 以内的完整视频。");
    const record: CompressionRecord = {
      version: 1,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      name: file.name,
      originalBytes: file.size,
      duration,
      options: { ...options },
      status: "running",
    };
    const controller = new AbortController();
    this.controller = controller;
    this.state.activeId = record.id;
    this.state.seconds = 0;
    this.state.records.unshift(record);
    this.emit();
    void (async () => {
      try {
        await this.storage.setItem(record.id, structuredClone(record));
        controller.signal.throwIfAborted();
        const video = await compress(
          file,
          options,
          controller.signal,
          (seconds) => {
            if (!controller.signal.aborted) {
              this.state.seconds = Math.max(this.state.seconds, seconds);
              this.emit();
            }
          },
        );
        controller.signal.throwIfAborted();
        if (!video.size || video.type !== "video/mp4")
          throw new Error("压缩结果不是有效的 MP4 视频。");
        // Retain the result in memory if saving fails, so the user can still export it.
        record.video = video;
        await this.storage.setItem(
          record.id,
          structuredClone({ ...record, status: "complete" }),
        );
        record.status = "complete";
        this.state.storageError = "";
      } catch (error) {
        record.status = "interrupted";
        record.error = controller.signal.aborted
          ? "已取消压缩，原视频未改动。"
          : error instanceof Error
            ? error.message
            : "压缩失败，请重新选择原视频。";
        try {
          await this.storage.setItem(record.id, structuredClone(record));
        } catch {
          this.state.storageError =
            "压缩记录保存失败，请保留窗口并导出已有结果，或释放磁盘空间。";
        }
      } finally {
        this.state.activeId = "";
        this.controller = undefined;
        this.emit();
      }
    })();
    return record.id;
  }
}
export const videoCompression = new VideoCompressionStore(
  localforage.createInstance({
    name: "tuzi-video-compression",
    storeName: "records",
  }),
);
