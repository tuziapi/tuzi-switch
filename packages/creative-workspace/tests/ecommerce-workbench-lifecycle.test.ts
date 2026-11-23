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
  it("does not bill ordinary generation for an unimplemented video processor", async () => {
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() =>
      expect(mocks.videoStore.getSnapshot().ready).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "视频背景移除", exact: true }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "尚未接入专用视频处理服务",
    );
    expect(
      screen.getByRole("button", { name: "生成视频" }).hasAttribute("disabled"),
    ).toBe(true);
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
