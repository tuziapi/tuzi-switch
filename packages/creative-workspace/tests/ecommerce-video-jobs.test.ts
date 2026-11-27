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
  it("owns immutable model parameters and restores them for pending jobs after restart", async () => {
    const storage = memory();
    const store = new EcommerceVideoStore(storage);
    const params = {
      vidu_sound_urls: "https://example.com/synthetic.mp3",
      seed: "42",
    };
    const executor = {
      generate: vi.fn().mockRejectedValue(new Error("synthetic stop")),
      download: vi.fn(async () => video()),
    };
    await store.start({ ...input, generationParams: params }, executor, 2);
    params.seed = "99";
    await idle(store);
    const restarted = new EcommerceVideoStore(storage);
    await restarted.load();
    const pending = restarted
      .getSnapshot()
      .jobs.find((j) => j.status === "pending")!;
    expect(pending.generationParams).toEqual({
      vidu_sound_urls: "https://example.com/synthetic.mp3",
      seed: "42",
    });
    executor.generate.mockResolvedValue("https://example.com/result.mp4");
    await restarted.resume(pending.id, input.owner, executor);
    await idle(restarted);
    expect(executor.generate.mock.lastCall?.[0].generationParams.seed).toBe(
      "42",
    );
  });
  it("honors pause while queue records are being saved before any paid submission", async () => {
    const storage = memory();
    const originalSave = storage.setItem;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.setItem = async (key, value) => {
      await gate;
      return originalSave(key, value);
    };
    const store = new EcommerceVideoStore(storage);
    const executor = { generate: vi.fn(), download: vi.fn() };
    const start = store.start(input, executor, 2);
    await vi.waitFor(() => expect(store.getSnapshot().activeId).not.toBe(""));
    store.pause();
    release();
    await start;
    await idle(store);
    expect(executor.generate).not.toHaveBeenCalled();
    expect(store.getSnapshot().jobs.map((j) => j.status)).toEqual([
      "pending",
      "pending",
    ]);
  });
  it("persists all plans before submitting and runs videos one at a time", async () => {
    const storage = memory();
    const store = new EcommerceVideoStore(storage);
    const executor = {
      generate: vi.fn(async () => {
        expect((await storage.keys()).length).toBe(3);
        return "https://example.invalid/synthetic.mp4";
      }),
      download: vi.fn(async () => video()),
    };
    await store.start(input, executor, 3);
    await vi.waitFor(() =>
      expect(
        store.getSnapshot().jobs.every((j) => j.status === "complete"),
      ).toBe(true),
    );
    expect(executor.generate).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().jobs.map((j) => j.label)).toEqual([
      "方案 1/3",
      "方案 2/3",
      "方案 3/3",
    ]);
  });
  it("failure leaves later videos unsent across restart; explicit continuation runs only pending jobs", async () => {
    const storage = memory();
    const store = new EcommerceVideoStore(storage);
    const executor = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new Error("synthetic interruption")),
      download: vi.fn(async () => video()),
    };
    await store.start(input, executor, 3);
    await idle(store);
    expect(store.getSnapshot().jobs.map((j) => j.status)).toEqual([
      "interrupted",
      "pending",
      "pending",
    ]);
    const restarted = new EcommerceVideoStore(storage);
    await restarted.load();
    expect(executor.generate).toHaveBeenCalledTimes(1);
    executor.generate.mockResolvedValue("https://example.invalid/result.mp4");
    const pending = restarted.getSnapshot().jobs.find((job) => job.status === "pending")!;
    expect(pending).toBeDefined();
    await restarted.resume(
      pending.id,
      input.owner,
      executor,
    );
    await vi.waitFor(() =>
      expect(
        restarted.getSnapshot().jobs.filter((j) => j.status === "complete"),
      ).toHaveLength(2),
    );
    expect(executor.generate).toHaveBeenCalledTimes(3);
  });
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
    await expect(store.start(input, executor)).rejects.toThrow("保存失败");
    await idle(store);
    expect(executor.generate).not.toHaveBeenCalled();
  });
});
