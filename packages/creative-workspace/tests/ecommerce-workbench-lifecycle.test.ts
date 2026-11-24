import React from "react";
import { Blob as NodeBlob } from "node:buffer";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  videoGenerate: vi.fn(),
  store: null as any,
  videoStore: null as any,
  models: null as Record<string, any[]> | null,
}));
vi.mock("../upstream/packages/drawnix/src/hooks/use-runtime-models", () => ({
  useSelectableModels: (type: string) =>
    mocks.models?.[type] || [
      { id: "synthetic-image", label: "Synthetic image" },
    ],
}));
vi.mock(
  "../upstream/packages/drawnix/src/utils/runtime-model-discovery",
  () => ({ getFallbackDefaultModelId: () => "synthetic-image" }),
);
vi.mock("../upstream/packages/drawnix/src/utils/settings-manager", () => ({
  getActiveInvocationPreset: () => undefined,
}));
vi.mock("../upstream/packages/drawnix/src/services/provider-routing", () => ({
  resolveInvocationPlanFromRoute: () => ({
    provider: { apiKey: "synthetic-key", profileName: "Synthetic" },
    binding: { submitPath: "/images/generations" },
  }),
}));
vi.mock("../src/ecommerce-generation", () => ({
  generateEcommerceVideo: mocks.videoGenerate,
  supportsEcommerceVideoReference: () => false,
  resolveEcommerceModelRef: (modelId: string) => ({ modelId }),
}));
vi.mock("../upstream/packages/drawnix/src/services/assistant-account", () => ({
  fetchOutputMedia: async () => ({
    ok: true,
    blob: async () =>
      new NodeBlob(["\0\0\0 ftypisom", new Uint8Array(32)], {
        type: "application/octet-stream",
      }),
  }),
}));
vi.mock("../src/ecommerce-video-jobs", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  ecommerceVideos: {
    getSnapshot: () => mocks.videoStore.getSnapshot(),
    subscribe: (fn: any) => mocks.videoStore.subscribe(fn),
    load: () => mocks.videoStore.load(),
    start: (...args: any[]) => mocks.videoStore.start(...args),
    resume: (...args: any[]) => mocks.videoStore.resume(...args),
    pause: () => mocks.videoStore.pause(),
  },
}));
vi.mock("../src/ecommerce-executor", () => ({
  createEcommerceExecutor: () => ({
    generate: mocks.generate,
    download: async () => new Blob(["synthetic"], { type: "image/png" }),
  }),
}));
vi.mock("../src/ecommerce-jobs", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  ecommerceJobs: {
    getSnapshot: () => mocks.store.getSnapshot(),
    subscribe: (fn: any) => mocks.store.subscribe(fn),
    load: () => mocks.store.load(),
    start: (...args: any[]) => mocks.store.start(...args),
    resume: (...args: any[]) => mocks.store.resume(...args),
    pause: () => mocks.store.pause(),
  },
}));
import { EcommerceWorkbench } from "../src/EcommerceWorkbench";
import { EcommerceJobStore } from "../src/ecommerce-jobs";
import { EcommerceVideoStore } from "../src/ecommerce-video-jobs";

beforeEach(() => {
  let objectUrlId = 0;
  mocks.generate.mockReset();
  mocks.videoGenerate.mockReset();
  mocks.models = null;
  const videoRecords = new Map<string, any>();
  mocks.videoStore = new EcommerceVideoStore({
    keys: async () => [...videoRecords.keys()],
    getItem: async (key) => videoRecords.get(key),
    setItem: async (key, value) => {
      videoRecords.set(key, structuredClone(value));
      return value;
    },
  });
  const records = new Map<string, any>();
  mocks.store = new EcommerceJobStore({
    keys: async () => [...records.keys()],
    getItem: async (key) => records.get(key),
    setItem: async (key, value) => {
      records.set(key, structuredClone(value));
      return value;
    },
  });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:synthetic-${objectUrlId++}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  mocks.store.pause();
  mocks.videoStore.pause();
  cleanup();
  vi.unstubAllGlobals();
});

async function setup() {
  const ui = render(React.createElement(EcommerceWorkbench));
  await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
  fireEvent.change(ui.container.querySelector('input[type="file"]')!, {
    target: {
      files: [new File(["synthetic"], "product.png", { type: "image/png" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成 4 张图片" }));
  return ui;
}

describe("sequential image workbench", () => {
  it("shares reference uploads across both entries and submits the remaining selection", async () => {
    mocks.generate.mockResolvedValue("synthetic-result");
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    const input = screen.getByLabelText("选择参考图片文件") as HTMLInputElement;
    const picker = vi.spyOn(input, "click");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });
    const third = new File(["third"], "third.png", { type: "image/png" });
    const fourth = new File(["fourth"], "fourth.png", { type: "image/png" });
    const choose = (files: File[]) =>
      fireEvent.change(input, { target: { files } });
    fireEvent.click(
      screen.getByRole("button", { name: "上传参考图片", exact: true }),
    );
    expect(picker).toHaveBeenCalledTimes(1);
    choose([first]);
    expect(screen.getByAltText("上传素材 1")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /已选择 1\/3 张参考图片/ }),
    );
    expect(picker).toHaveBeenCalledTimes(2);
    choose([first, second]);
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "继续添加参考图片" }));
    expect(picker).toHaveBeenCalledTimes(3);
    choose([]); // Cancelling the picker keeps existing references.
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(2);
    choose([third, fourth]);
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(3);
    expect(screen.getByText(/多余图片未添加/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /已选择 3\/3 张参考图片/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "继续添加参考图片" }),
    ).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "移除素材" })[1]);
    choose([new File(["video"], "clip.mp4", { type: "video/mp4" })]);
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(2);
    expect(screen.getByText("请选择图片文件。")).toBeTruthy();
    choose([second]);
    expect(input.value).toBe("");
    fireEvent.click(screen.getAllByRole("button", { name: "移除素材" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "生成 4 张图片" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(4));
    for (const [batch] of mocks.generate.mock.calls) {
      expect(batch.references).toEqual([third, second]);
    }
  });

  it("removes all image options when switching to video with multiple provider entries", async () => {
    const images = [
      {
        id: "gpt-image-2",
        label: "gpt-image-2",
        sourceProfileId: "synthetic-a",
      },
      {
        id: "gpt-image-2",
        label: "gpt-image-2",
        sourceProfileId: "synthetic-b",
      },
      {
        id: "gpt-image-2.6",
        label: "gpt-image-2.6",
        sourceProfileId: "synthetic-a",
      },
      {
        id: "gpt-image-2.6",
        label: "gpt-image-2.6",
        sourceProfileId: "synthetic-b",
      },
    ];
    mocks.models = {
      image: images,
      video: [...images, { id: "MiniMax-H3", label: "MiniMax-H3" }],
    };
    render(React.createElement(EcommerceWorkbench));
    const imageSelect = screen.getByRole("combobox", {
      name: "生成模型",
    }) as HTMLSelectElement;
    const chosen = [...imageSelect.options].find(
      (option) => option.textContent === "gpt-image-2 · synthetic-b",
    )!;
    expect(chosen).toBeTruthy();
    fireEvent.change(imageSelect, { target: { value: chosen.value } });
    expect(imageSelect.value).toBe(chosen.value);
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    const select = screen.getByRole("combobox", {
      name: "生成模型",
    }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "MiniMax-H3",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "商品", exact: true }));
    expect(
      (screen.getByRole("combobox", { name: "生成模型" }) as HTMLSelectElement)
        .value,
    ).toBe(chosen.value);
  });
  it("submits video parameters and restores a saved video after leaving the page", async () => {
    mocks.videoGenerate.mockImplementation(async (params) => {
      await params.onSubmitted("synthetic-task");
      return ["https://example.invalid/video.mp4"];
    });
    let ui = render(React.createElement(EcommerceWorkbench));
    await waitFor(() =>
      expect(mocks.videoStore.getSnapshot().ready).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "带货视频", exact: true }),
    );
    fireEvent.change(ui.container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(["synthetic"], "product.png", { type: "image/png" })],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "生成视频", exact: true }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存视频" })).toBeTruthy(),
    );
    expect(mocks.videoGenerate).toHaveBeenCalledTimes(1);
    expect(mocks.videoGenerate.mock.calls[0][0].size).not.toBe("1024x1024");
    expect(mocks.videoGenerate.mock.calls[0][0].seconds).toBeTruthy();
    ui.unmount();
    ui = render(React.createElement(EcommerceWorkbench));
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "带货视频", exact: true }),
    );
    expect(screen.getByRole("button", { name: "保存视频" })).toBeTruthy();
    expect(mocks.videoGenerate).toHaveBeenCalledTimes(1);
  });
  it("hides unimplemented processors without deleting existing video records or billing", async () => {
    const legacyRecords = [
      "video-remove-background",
      "video-4k",
      "video-enhance",
      "video-remove-watermark",
    ].map((tool) => ({
      version: 1,
      id: `synthetic-legacy-${tool}`,
      tool,
      owner: null,
      createdAt: 1,
      modelRef: { modelId: "synthetic-video" },
      prompt: "SYNTHETIC",
      size: "768P",
      seconds: "5",
      aspectRatio: "16:9",
      status: "complete",
    }));
    const write = vi.fn();
    mocks.videoStore = new EcommerceVideoStore({
      keys: async () => legacyRecords.map((record) => record.id),
      getItem: async (id) =>
        structuredClone(
          legacyRecords.find((record) => record.id === id),
        ) as any,
      setItem: write,
    });
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() =>
      expect(mocks.videoStore.getSnapshot().ready).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    const records = mocks.videoStore.getSnapshot().jobs;
    for (const name of [
      "视频背景移除",
      "视频4K超分",
      "视频变清晰",
      "视频去水印",
    ]) {
      expect(screen.queryByRole("button", { name, exact: true })).toBeNull();
    }
    for (const name of ["视频复刻", "带货视频", "视频压缩"]) {
      expect(screen.getByRole("button", { name, exact: true })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "商品", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    expect(mocks.videoStore.getSnapshot().jobs).toEqual(records);
    expect(records).toHaveLength(4);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.videoGenerate).not.toHaveBeenCalled();
  });
  it("shows first image while the next is running, and keeps working across page remounts", async () => {
    let finish!: (url: string) => void;
    mocks.generate
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue("next");
    const ui = await setup();
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
    expect(screen.getByAltText("生成结果")).toBeTruthy();
    expect(screen.getByText("已完成 1 / 4 张")).toBeTruthy();
    const signal = mocks.generate.mock.calls[1][2];
    ui.unmount();
    render(React.createElement(EcommerceWorkbench));
    expect(signal.aborted).toBe(false);
    expect(screen.getByText("已完成 1 / 4 张")).toBeTruthy();
    await act(async () => {
      finish("second");
    });
    await waitFor(() =>
      expect(screen.getByText("已完成 4 / 4 张")).toBeTruthy(),
    );
    expect(mocks.generate).toHaveBeenCalledTimes(4);
    const thumbnail = screen.getByRole("button", { name: "查看核心卖点图" });
    fireEvent.click(thumbnail);
    expect(thumbnail.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByAltText("生成结果").getAttribute("src")).toBe(
      thumbnail.querySelector("img")?.getAttribute("src"),
    );
    expect(mocks.generate).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole("button", { name: "暂停生成" })).toBeNull();
  });
  it("pause preserves completed results; explicit retry only retries that image", async () => {
    mocks.generate
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(async (_batch, _item, _signal, report) => {
        await report({ stage: "sending" });
        return new Promise(() => {});
      });
    await setup();
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "暂停生成" }));
    await waitFor(() => expect(screen.getByText("结果待核对")).toBeTruthy());
    expect(screen.getByAltText("生成结果")).toBeTruthy();
    mocks.generate.mockResolvedValueOnce("second");
    fireEvent.click(screen.getByRole("button", { name: "重试这一张" }));
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "确认重试这一张" }));
    await waitFor(() =>
      expect(screen.getByText("已完成 2 / 4 张")).toBeTruthy(),
    );
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole("button", { name: "继续未发送的图片" }),
    ).toBeTruthy();
  });
});
