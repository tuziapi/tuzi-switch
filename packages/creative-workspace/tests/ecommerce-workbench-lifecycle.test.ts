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
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  it("cycles only after opting in, wraps around, and pauses on hover and on demand", async () => {
    mocks.generate.mockResolvedValue("synthetic-result");
    const ui = await setup();
    await waitFor(() =>
      expect(screen.getByText("已完成 4 / 4 张")).toBeTruthy(),
    );
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.useFakeTimers();
    const tick = (ms = 4000) => act(() => vi.advanceTimersByTime(ms));
    tick();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "自动播放" }));
    tick(3999);
    expect(screen.getByText("1 / 4")).toBeTruthy();
    tick(1);
    expect(screen.getByText("2 / 4")).toBeTruthy();
    tick(12000);
    expect(screen.getByText("1 / 4")).toBeTruthy();
    const preview = ui.container.querySelector(".ecommerce-preview__canvas")!;
    fireEvent.mouseEnter(preview);
    tick(12000);
    expect(screen.getByText("1 / 4")).toBeTruthy();
    fireEvent.mouseLeave(preview);
    tick();
    expect(screen.getByText("2 / 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "暂停播放" }));
    tick(12000);
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(mocks.generate).toHaveBeenCalledTimes(4);
  });

  it("stops playback for manual selection, keyboard focus, backgrounding and remount", async () => {
    mocks.generate.mockResolvedValue("synthetic-result");
    const ui = await setup();
    await waitFor(() =>
      expect(screen.getByText("已完成 4 / 4 张")).toBeTruthy(),
    );
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.useFakeTimers();
    const play = () =>
      fireEvent.click(screen.getByRole("button", { name: "自动播放" }));
    const stays = (page: string) => {
      act(() => vi.advanceTimersByTime(8000));
      expect(screen.getByText(page)).toBeTruthy();
      expect(screen.getByRole("button", { name: "自动播放" })).toBeTruthy();
    };
    play();
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    stays("2 / 4");
    play();
    fireEvent.click(screen.getByRole("button", { name: "查看首图主视觉" }));
    stays("1 / 4");
    play();
    fireEvent.focus(screen.getByRole("button", { name: "插入画布" }));
    stays("1 / 4");
    play();
    fireEvent(window, new Event("blur"));
    stays("1 / 4");
    play();
    hidden.mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    stays("1 / 4");
    play();
    ui.unmount();
    render(React.createElement(EcommerceWorkbench));
    stays("1 / 4");
    expect(mocks.generate).toHaveBeenCalledTimes(4);
  });

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
    expect(screen.queryByRole("button", { name: "自动播放" })).toBeNull();
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
