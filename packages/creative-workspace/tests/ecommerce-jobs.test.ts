import { describe, expect, it, vi } from "vitest";
import {
  EcommerceJobStore,
  planEcommerceImages,
  type BatchExecutor,
  type EcommerceBatch,
} from "../src/ecommerce-jobs";

function memory() {
  const data = new Map<string, any>();
  return {
    data,
    keys: async () => [...data.keys()],
    getItem: async <T>(key: string) => data.get(key) as T,
    setItem: async <T>(key: string, value: T) => {
      data.set(key, structuredClone(value));
      return value;
    },
  };
}
const input = () => ({
  title: "Synthetic",
  tool: "product-set",
  modelRef: { modelId: "synthetic" },
  owner: null,
  size: "1024x1024",
  references: [],
  items: [
    { label: "主图", prompt: "hero" },
    { label: "细节", prompt: "detail" },
  ],
});
const image = () => new Blob(["synthetic"], { type: "image/png" });
const waitIdle = async (store: EcommerceJobStore) =>
  vi.waitFor(() => expect(store.getSnapshot().activeId).toBe(""));

describe("durable sequential ecommerce images", () => {
  it("plans selected modules instead of hidden eight-image count; custom counts stay exact", () => {
    const base = {
      tool: "product-set",
      structure: "smart",
      labels: ["主图", "场景"],
      apparelTypes: [],
      counts: { scene: 3, sellingPoint: 3, whiteBackground: 1, other: 1 },
      prompt: "synthetic",
    };
    expect(planEcommerceImages(base)).toHaveLength(2);
    expect(planEcommerceImages({ ...base, structure: "custom" })).toHaveLength(
      8,
    );
    expect(
      planEcommerceImages({
        ...base,
        tool: "detail-page",
        labels: ["细节图"],
      }).map((i) => i.label),
    ).toEqual(["首屏主视觉", "细节图"]);
    expect(planEcommerceImages(base)[0].prompt).toContain("仅生成一张独立");
  });
  it("persists the first result before submitting the next; progress survives subscriber removal", async () => {
    const storage = memory();
    const store = new EcommerceJobStore(storage);
    let finish!: (url: string) => void;
    const generate = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
    const executor = { generate, download: vi.fn(async () => image()) };
    const unsubscribe = store.subscribe(vi.fn());
    await store.start(input(), executor);
    unsubscribe();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(store.getSnapshot().batches[0].items[0].status).toBe("complete");
    expect([...storage.data.values()][0].items[0].image).toBeTruthy();
    finish("second");
    await waitIdle(store);
    expect(store.getSnapshot().batches[0].items.map((i) => i.status)).toEqual([
      "complete",
      "complete",
    ]);
  });
  it("retry targets only a failed item, keeps history and never regenerates successful images", async () => {
    const store = new EcommerceJobStore(memory());
    const generate = vi
      .fn<BatchExecutor["generate"]>()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("synthetic"));
    const executor = { generate, download: vi.fn(async () => image()) };
    const id = await store.start(input(), executor);
    await waitIdle(store);
    const batch = store.getSnapshot().batches[0];
    generate.mockResolvedValueOnce("second");
    await store.resume(id, executor, null, batch.items[1].id);
    await waitIdle(store);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls.map((call) => call[1].label)).toEqual([
      "主图",
      "细节",
      "细节",
    ]);
    expect(batch.items[1].attempts).toHaveLength(2);
    expect(new Set(batch.items[1].attempts.map((a) => a.requestId)).size).toBe(
      2,
    );
  });
  it("restart restores completed images and marks in-flight unknown without submitting anything", async () => {
    const storage = memory();
    const saved: EcommerceBatch = {
      ...input(),
      id: "saved",
      version: 1,
      createdAt: 1,
      items: [
        {
          id: "a",
          label: "主图",
          prompt: "hero",
          status: "complete",
          image: image(),
          attempts: [],
        },
        {
          id: "b",
          label: "细节",
          prompt: "detail",
          status: "running",
          attempts: [
            { requestId: "synthetic", startedAt: 1, stage: "sending" },
          ],
        },
        {
          id: "c",
          label: "场景",
          prompt: "scene",
          status: "pending",
          attempts: [],
        },
      ],
    };
    await storage.setItem("batch:saved", saved);
    const store = new EcommerceJobStore(storage);
    await store.load();
    expect(store.getSnapshot().activeId).toBe("");
    expect(store.getSnapshot().batches[0].items.map((i) => i.status)).toEqual([
      "complete",
      "unknown",
      "pending",
    ]);
    const generate = vi.fn(async () => "scene");
    await store.resume(
      "saved",
      { generate, download: async () => image() },
      null,
    );
    await waitIdle(store);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1].id).toBe("c");
  });
  it("pause bounds stalled work, discards late output, and leaves later images unsent", async () => {
    const store = new EcommerceJobStore(memory());
    let finish!: (url: string) => void;
    const generate = vi.fn<BatchExecutor["generate"]>(
      async (_batch, _item, _signal, report) => {
        await report({ stage: "sending" });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await store.start(input(), { generate, download: async () => image() });
    await vi.waitFor(() => expect(finish).toBeDefined());
    store.pause();
    await waitIdle(store);
    expect(store.getSnapshot().batches[0].items.map((i) => i.status)).toEqual([
      "unknown",
      "pending",
    ]);
    finish("late");
    await Promise.resolve();
    expect(store.getSnapshot().batches[0].items[0].image).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("timeout ends waiting without replay and blocks another run while busy", async () => {
    const store = new EcommerceJobStore(memory(), 40);
    const generate = vi.fn<BatchExecutor["generate"]>(
      async (_batch, _item, _signal, report) => {
        await report({ stage: "sending" });
        return new Promise(() => {});
      },
    );
    const executor = { generate, download: async () => image() };
    await store.start(input(), executor);
    await expect(store.start(input(), executor)).rejects.toThrow("已有");
    await waitIdle(store);
    expect(store.getSnapshot().batches[0].items[0].status).toBe("unknown");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("download retry never submits or bills the model again", async () => {
    const store = new EcommerceJobStore(memory());
    const generate = vi.fn(async () => "https://example.invalid/result.png");
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic download failure"))
      .mockResolvedValueOnce(image());
    const id = await store.start(input(), { generate, download });
    await waitIdle(store);
    const item = store.getSnapshot().batches[0].items[0];
    await store.resume(id, { generate, download }, null, item.id);
    await waitIdle(store);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(2);
    expect(item.status).toBe("complete");
  });
  it("storage failure prevents paid submission and rejects cross-account resume", async () => {
    const storage = memory();
    storage.setItem = vi.fn().mockRejectedValue(new Error("quota"));
    const store = new EcommerceJobStore(storage);
    const generate = vi.fn();
    const id = await store.start(
      { ...input(), owner: "synthetic-user" },
      { generate, download: async () => image() },
    );
    await waitIdle(store);
    expect(generate).not.toHaveBeenCalled();
    expect(store.getSnapshot().storageError).toContain("保存失败");
    await expect(
      store.resume(id, { generate, download: async () => image() }, "other"),
    ).rejects.toThrow("切回");
  });
  it("a failed final disk write retains the Blob and retries saving without another model call", async () => {
    const storage = memory();
    const write = storage.setItem;
    let blockComplete = true;
    storage.setItem = async (key, value) => {
      if (
        blockComplete &&
        (value as EcommerceBatch).items.some(
          (item) => item.status === "complete",
        )
      )
        throw new Error("quota");
      return write(key, value);
    };
    const store = new EcommerceJobStore(storage);
    const generate = vi.fn(async () => "synthetic-result");
    const download = vi.fn(async () => image());
    const id = await store.start(input(), { generate, download });
    await waitIdle(store);
    const item = store.getSnapshot().batches[0].items[0];
    expect(item.status).not.toBe("complete");
    expect(item.image).toBeTruthy();
    expect(store.getSnapshot().batches[0].items[1].status).toBe("pending");
    blockComplete = false;
    await store.resume(id, { generate, download }, null, item.id);
    await waitIdle(store);
    expect(item.status).toBe("complete");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
