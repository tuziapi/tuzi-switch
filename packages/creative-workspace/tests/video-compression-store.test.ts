import { describe, it, expect, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { VideoCompressionStore } from "../src/video-compression-store";
const options = {
  quality: "balanced",
  resolution: "720p",
  keepAudio: true,
} as const;
function fixture() {
  const records = new Map<string, any>();
  const storage = {
    keys: async () => [...records.keys()],
    getItem: async (key: string) => records.get(key) ?? null,
    setItem: vi.fn(async (key: string, value: any) => {
      records.set(key, structuredClone(value));
      return value;
    }),
  };
  return { records, storage, store: new VideoCompressionStore(storage as any) };
}
const file = () =>
  new File([new Uint8Array(4096)], "synthetic.mp4", { type: "video/mp4" });
async function idle(store: VideoCompressionStore) {
  await vi.waitFor(() => expect(store.getSnapshot().activeId).toBe(""));
}
describe("offline compression lifecycle", () => {
  it("persists results across restart without any remote task or credentials", async () => {
    const { store, storage } = fixture();
    await store.start(
      file(),
      4,
      options,
      async (_file, _opts, _signal, progress) => {
        progress(2);
        return new NodeBlob(["synthetic-result"], {
          type: "video/mp4",
        }) as Blob;
      },
    );
    await idle(store);
    expect(store.getSnapshot().records[0]).toMatchObject({
      status: "complete",
      originalBytes: 4096,
      options,
    });
    const restarted = new VideoCompressionStore(storage as any);
    await restarted.load();
    expect(restarted.getSnapshot().records[0].video?.size).toBe(16);
    expect(restarted.getSnapshot().records[0]).not.toHaveProperty("taskId");
    expect(restarted.getSnapshot().records[0]).not.toHaveProperty("modelRef");
  });
  it("cancels the actual engine, rejects overlap, and never stores late output", async () => {
    const { store } = fixture();
    let finish!: (value: Blob) => void;
    let signal!: AbortSignal;
    await store.start(file(), 4, options, async (_f, _o, s) => {
      signal = s;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(store.start(file(), 4, options, vi.fn())).rejects.toThrow(
      "正在压缩",
    );
    store.cancel();
    expect(signal.aborted).toBe(true);
    finish(new Blob(["late"], { type: "video/mp4" }));
    await idle(store);
    expect(store.getSnapshot().records[0]).toMatchObject({
      status: "interrupted",
      error: "已取消压缩，原视频未改动。",
    });
    expect(store.getSnapshot().records[0].video).toBeUndefined();
  });
  it("keeps unsaved output exportable after storage failure", async () => {
    const { store, storage } = fixture();
    storage.setItem
      .mockImplementationOnce(async (_key, value) => value)
      .mockRejectedValue(new Error("磁盘已满"));
    await store.start(
      file(),
      4,
      options,
      async () => new Blob(["result"], { type: "video/mp4" }),
    );
    await idle(store);
    expect(store.getSnapshot().records[0].video?.size).toBe(6);
    expect(store.getSnapshot().storageError).toContain("导出");
    expect(store.getSnapshot().records[0].status).toBe("interrupted");
  });
  it("marks interrupted local work without remote billing instructions", async () => {
    const { store, records } = fixture();
    records.set("job", {
      version: 1,
      id: "job",
      createdAt: 1,
      name: "synthetic.mp4",
      originalBytes: 100,
      duration: 4,
      options,
      status: "running",
    });
    await store.load();
    expect(store.getSnapshot().records[0].error).toContain("重新选择原视频");
    expect(store.getSnapshot().records[0].error).not.toContain("计费");
  });
  it("does not start the engine when initial persistence fails", async () => {
    const { store, storage } = fixture();
    storage.setItem.mockRejectedValue(new Error("存储不可用"));
    const engine = vi.fn();
    await store.start(file(), 4, options, engine);
    await idle(store);
    expect(engine).not.toHaveBeenCalled();
  });
});
