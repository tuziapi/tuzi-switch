import { describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import {
  EcommerceVideoStore,
  type VideoExecutor,
} from "../src/ecommerce-video-jobs";

function memory() {
  const records = new Map<string, any>();
  return {
    keys: async () => [...records.keys()],
    getItem: async <T>(key: string) => records.get(key) as T,
    setItem: async <T>(key: string, value: T) => {
      records.set(key, structuredClone(value));
      return value;
    },
  };
}
const input = {
  tool: "video-commerce",
  owner: "synthetic-owner",
  modelRef: { modelId: "synthetic-video" },
  prompt: "synthetic",
  size: "720p",
  seconds: "3",
  aspectRatio: "16:9",
};
const idle = async (store: EcommerceVideoStore) =>
  vi.waitFor(() => expect(store.getSnapshot().activeId).toBe(""));
const video = () =>
  new NodeBlob(["synthetic-video"], { type: "video/mp4" }) as unknown as Blob;
describe("durable ecommerce videos", () => {
  it("keeps running without a view and restores saved video after restart", async () => {
    const storage = memory();
    const store = new EcommerceVideoStore(storage);
    const unsubscribe = store.subscribe(() => {});
    const executor: VideoExecutor = {
      generate: async (_job, _signal, submitted) => {
        await submitted("remote-task");
        return "https://example.invalid/video.mp4";
      },
      download: async () => video(),
    };
    await store.start(input, executor);
    unsubscribe();
    await idle(store);
    const restarted = new EcommerceVideoStore(storage);
    await restarted.load();
    expect(restarted.getSnapshot().jobs[0]).toMatchObject({
      status: "complete",
      taskId: "remote-task",
      video: { size: 15 },
    });
  });
  it("download failure retries download only, never generates a second time", async () => {
    const store = new EcommerceVideoStore(memory());
    const executor = {
      generate: vi.fn(async (_job, _signal, submitted) => {
        await submitted("remote-task");
        return "https://example.invalid/video.mp4";
      }),
      download: vi
        .fn()
        .mockRejectedValueOnce(new Error("download failed"))
        .mockResolvedValue(video()),
    };
    const id = await store.start(input, executor);
    await idle(store);
    await store.resume(id, input.owner, executor);
    await idle(store);
    expect(executor.generate).toHaveBeenCalledTimes(1);
    expect(executor.download).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().jobs[0].status).toBe("complete");
  });
  it("persists late task ID after pause and requires same owner for resume", async () => {
    const storage = memory();
    const store = new EcommerceVideoStore(storage);
    let late!: () => Promise<void>;
    const id = await store.start(input, {
      generate: async (_job, _signal, submitted) => {
        late = () => submitted("late-task");
        return new Promise(() => {});
      },
      download: async () => video(),
    });
    await vi.waitFor(() => expect(late).toBeTypeOf("function"));
    store.pause();
    await idle(store);
    await late();
    const restarted = new EcommerceVideoStore(storage);
    await restarted.load();
    expect(restarted.getSnapshot().jobs[0]).toMatchObject({
      taskId: "late-task",
      status: "interrupted",
    });
    const executor = {
      generate: vi.fn().mockResolvedValue("result"),
      download: async () => video(),
    };
    await expect(restarted.resume(id, "other-owner", executor)).rejects.toThrow(
      "切回",
    );
    expect(executor.generate).not.toHaveBeenCalled();
    await restarted.resume(id, input.owner, executor);
    await idle(restarted);
    expect(executor.generate.mock.calls[0][0].taskId).toBe("late-task");
  });
  it("storage failure prevents the paid call", async () => {
    const storage = memory();
    storage.setItem = async () => {
      throw new Error("disk full");
    };
    const store = new EcommerceVideoStore(storage);
    const executor = { generate: vi.fn(), download: vi.fn() };
    await store.start(input, executor);
    await idle(store);
    expect(executor.generate).not.toHaveBeenCalled();
  });
});
