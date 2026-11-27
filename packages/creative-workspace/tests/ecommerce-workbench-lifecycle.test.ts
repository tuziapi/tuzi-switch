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
  localStorage.clear();
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
  it("adapts Vidu modes and Mix audio in the real form and snapshots parameters outside preferences", async () => {
    mocks.models = {
      video: ["viduq4-preview", "viduq3-turbo", "viduq3-mix"].map((id) => ({
        id,
        label: id,
      })),
    };
    mocks.videoGenerate.mockImplementation(async (params) => {
      await params.onSubmitted("synthetic-mix-task");
      return ["https://example.invalid/video.mp4"];
    });
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() =>
      expect(mocks.videoStore.getSnapshot().ready).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "带货视频", exact: true }),
    );
    const selectModel = (id: string) =>
      fireEvent.change(screen.getByRole("combobox", { name: "生成模型" }), {
        target: { value: `[null,"${id}"]` },
      });
    selectModel("viduq4-preview");
    expect(screen.getByText("点击添加图片，最多 15 张")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "生成 1 条视频",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("视频比例") as HTMLSelectElement).disabled,
    ).toBe(true);
    selectModel("viduq3-turbo");
    expect(
      (
        screen.getByRole("button", {
          name: "生成 1 条视频",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("视频模式"), {
      target: { value: "referenceGenerate" },
    });
    expect(
      (screen.getByLabelText("视频时长") as HTMLSelectElement).options[0].value,
    ).toBe("3");
    expect(
      (
        screen.getByRole("button", {
          name: "生成 1 条视频",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    selectModel("viduq3-mix");
    fireEvent.change(screen.getByLabelText("选择商品原图文件"), {
      target: {
        files: [new File(["synthetic"], "product.png", { type: "image/png" })],
      },
    });
    fireEvent.change(screen.getByLabelText("参考音频 URL"), {
      target: { value: "https://example.com/synthetic-track.mp3" },
    });
    fireEvent.change(screen.getByLabelText("视频比例"), {
      target: { value: "3:4" },
    });
    expect(screen.getByRole("button", { name: "应用建议比例" })).toBeTruthy();
    expect(
      localStorage.getItem("opentu-ecommerce-preferences-v1"),
    ).not.toContain("synthetic-track");
    fireEvent.click(screen.getByRole("button", { name: "生成 1 条视频" }));
    await waitFor(() => expect(mocks.videoGenerate).toHaveBeenCalledTimes(1));
    expect(mocks.videoGenerate.mock.calls[0][0]).toMatchObject({
      aspectRatio: "3:4",
      generationParams: {
        vidu_sound_urls: "https://example.com/synthetic-track.mp3",
      },
    });
    expect(
      mocks.videoStore.getSnapshot().jobs[0].generationParams.vidu_sound_urls,
    ).toBe("https://example.com/synthetic-track.mp3");
  });
  it("scopes reference controls and drafts to each tool, excluding hidden references from requests", async () => {
    mocks.generate.mockResolvedValue("synthetic-result");
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    const upload = (label: string, name: string) =>
      fireEvent.change(screen.getByLabelText(label), {
        target: {
          files: [new File(["synthetic"], name, { type: "image/png" })],
        },
      });
    const choose = (name: string) =>
      fireEvent.click(screen.getByRole("button", { name, exact: true }));

    expect(screen.queryByLabelText("上传风格参考图")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "风格参考图 选填" }));
    upload("上传风格参考图", "set-style.png");
    choose("A+/详情页");
    expect(
      screen
        .getByRole("button", { name: "风格参考图 选填" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByAltText("风格参考图 1")).toBeNull();

    choose("爆款复刻");
    expect(screen.getByText("必填 · 1–2 张")).toBeTruthy();
    expect(screen.queryByAltText("爆款参考图 1")).toBeNull();
    upload("选择商品原图文件", "product.png");
    expect(
      (
        screen.getByRole("button", {
          name: "生成 1 张图片",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    upload("上传爆款参考图", "viral-style.png");
    expect(
      (
        screen.getByRole("button", {
          name: "生成 1 张图片",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    for (const name of ["白底精修", "产品换色", "产品精修"]) {
      choose(name);
      expect(screen.queryByLabelText("上传爆款参考图")).toBeNull();
      expect(screen.queryByLabelText("上传风格参考图")).toBeNull();
      expect(screen.queryByRole("button", { name: /风格参考图/ })).toBeNull();
    }
    upload("选择商品原图文件", "retouch.png");
    choose("生成 1 张图片");
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    const retouchBatch = mocks.store.getSnapshot().batches[0];
    expect(retouchBatch.references.map((file: File) => file.name)).toEqual([
      "retouch.png",
    ]);
    expect(retouchBatch.referenceRoles).toEqual(["product"]);
    expect(retouchBatch.items[0].prompt).not.toContain("第2至");

    choose("商品套图");
    expect(screen.getByAltText("风格参考图 1")).toBeTruthy();
    upload("选择商品原图文件", "set-product.png");
    choose("生成 4 张图片");
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(5));
    const setBatch = mocks.store
      .getSnapshot()
      .batches.find((batch: any) => batch.tool === "product-set");
    expect(setBatch.references.map((file: File) => file.name)).toEqual([
      "set-product.png",
      "set-style.png",
    ]);

    choose("爆款复刻");
    expect(screen.getByAltText("爆款参考图 1")).toBeTruthy();
    choose("穿戴");
    expect(screen.queryByLabelText("上传爆款参考图")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "人物 / 姿势参考 选填" }),
    );
    upload("上传人物 / 姿势参考", "person.png");
    choose("模特换姿");
    expect(
      screen
        .getByRole("button", { name: "人物 / 姿势参考 选填" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByAltText("人物 / 姿势参考 1")).toBeNull();
  });

  it("uses the visible apparel selections as outputs instead of a separate hidden selection", async () => {
    mocks.generate.mockResolvedValue("synthetic-apparel");
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "穿戴", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "人台展示图数量增加" }));
    fireEvent.click(
      screen.getByRole("button", { name: /细节特写图 展示面料/ }),
    );
    fireEvent.change(screen.getByLabelText("选择商品原图文件"), {
      target: {
        files: [new File(["synthetic"], "garment.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成 5 张图片" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(5));
    expect(
      mocks.store.getSnapshot().batches[0].items.map((i: any) => i.label),
    ).toEqual([
      "白底精修图",
      "3D 立体效果图",
      "人台展示图 · 方案 1",
      "人台展示图 · 方案 2",
      "细节特写图",
    ]);
  });
  it("submits separate selected directions with explicit quantities and ordered material roles", async () => {
    mocks.generate.mockResolvedValue("synthetic-result");
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    fireEvent.click(
      screen.getByRole("button", { name: "爆款复刻", exact: true }),
    );
    fireEvent.change(screen.getByLabelText("选择商品原图文件"), {
      target: {
        files: [new File(["product"], "product.png", { type: "image/png" })],
      },
    });
    fireEvent.change(screen.getByLabelText("上传爆款参考图"), {
      target: {
        files: [new File(["style"], "style.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /分别出图 每个方向/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "复刻光影风格数量增加" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成 4 张图片" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(4));
    const batch = mocks.store.getSnapshot().batches[0];
    expect(batch.referenceRoles).toEqual(["product", "style"]);
    expect(batch.references.map((f: File) => f.name)).toEqual([
      "product.png",
      "style.png",
    ]);
    expect(batch.items.map((i: any) => i.label)).toEqual([
      "复刻爆款构图",
      "复刻光影风格 · 方案 1",
      "复刻光影风格 · 方案 2",
      "强化商品卖点",
    ]);
    expect(batch.items[0].prompt).toContain("第2至2张为风格参考图");
    expect(batch.items[0].prompt).not.toContain(
      "整体要求：复刻爆款构图、复刻光影风格",
    );
  });
  it("preserves an explicit provider through delayed catalog loading and never submits through another provider", async () => {
    localStorage.setItem(
      "opentu-ecommerce-preferences-v1",
      JSON.stringify({
        version: 1,
        selectedModels: {
          image: '["synthetic-b","gpt-image-2"]',
          video: "MiniMax-H3",
        },
      }),
    );
    mocks.models = {
      image: [
        { id: "gpt-image-2", label: "Image", sourceProfileId: "synthetic-a" },
      ],
      video: [],
    };
    const ui = render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    fireEvent.change(screen.getByLabelText("选择商品原图文件"), {
      target: {
        files: [new File(["synthetic"], "image.png", { type: "image/png" })],
      },
    });
    const generate = screen.getByRole("button", {
      name: "生成 4 张图片",
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(
      (screen.getByRole("combobox", { name: "生成模型" }) as HTMLSelectElement)
        .selectedOptions[0].textContent,
    ).toContain("之前选择暂不可用");
    fireEvent.click(generate);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.models.image = [
      ...mocks.models.image,
      { id: "gpt-image-2", label: "Image", sourceProfileId: "synthetic-b" },
    ];
    ui.rerender(React.createElement(EcommerceWorkbench));
    expect(
      (screen.getByRole("combobox", { name: "生成模型" }) as HTMLSelectElement)
        .value,
    ).toBe('["synthetic-b","gpt-image-2"]');
    expect(generate.disabled).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("keeps the selected provider, brief, quick options and video settings after remount without submitting", async () => {
    mocks.models = {
      image: [
        { id: "gpt-image-2", label: "Image", sourceProfileId: "synthetic-a" },
        { id: "gpt-image-2", label: "Image", sourceProfileId: "synthetic-b" },
      ],
      video: [{ id: "MiniMax-H3", label: "MiniMax-H3" }],
    };
    const ui = render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    const model = screen.getByRole("combobox", {
      name: "生成模型",
    }) as HTMLSelectElement;
    const chosen = model.options[1].value;
    fireEvent.change(model, { target: { value: chosen } });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Synthetic retained brief" },
    });
    const quick = ui.container.querySelector(
      '.ecommerce-modules__grid button[aria-pressed="true"]',
    )!;
    const quickName = quick.textContent!;
    fireEvent.click(quick);
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    fireEvent.change(screen.getByRole("combobox", { name: "生成模型" }), {
      target: { value: '[null,"MiniMax-H3"]' },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "视频比例" }), {
      target: { value: "9:16" },
    });
    ui.unmount();
    const restored = render(React.createElement(EcommerceWorkbench));
    expect(
      (screen.getByRole("combobox", { name: "生成模型" }) as HTMLSelectElement)
        .value,
    ).toBe(chosen);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Synthetic retained brief",
    );
    const restoredQuick = [
      ...restored.container.querySelectorAll(".ecommerce-modules__grid button"),
    ].find((button) => button.textContent === quickName)!;
    expect(restoredQuick.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    expect(
      (screen.getByRole("combobox", { name: "生成模型" }) as HTMLSelectElement)
        .value,
    ).toBe('[null,"MiniMax-H3"]');
    expect(
      (screen.getByRole("combobox", { name: "视频比例" }) as HTMLSelectElement)
        .value,
    ).toBe("9:16");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.videoGenerate).not.toHaveBeenCalled();
  });

  it("locks MiniMax image-to-video to the first frame and restores the chosen text-to-video ratio after removal", async () => {
    mocks.models = { video: [{ id: "MiniMax-H3", label: "MiniMax-H3" }] };
    mocks.videoGenerate.mockImplementation(async (params) => {
      await params.onSubmitted("synthetic-ratio-task");
      return ["https://example.invalid/video.mp4"];
    });
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() =>
      expect(mocks.videoStore.getSnapshot().ready).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "视频", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "带货视频", exact: true }),
    );
    const ratio = screen.getByRole("combobox", {
      name: "视频比例",
    }) as HTMLSelectElement;
    fireEvent.change(ratio, { target: { value: "9:16" } });
    fireEvent.change(screen.getByLabelText("选择商品原图文件"), {
      target: {
        files: [new File(["synthetic"], "square.png", { type: "image/png" })],
      },
    });
    expect(ratio.disabled).toBe(true);
    expect(ratio.value).toBe("adaptive");
    expect(ratio.selectedOptions[0].textContent).toBe("跟随首帧图片");
    fireEvent.click(
      screen.getByRole("button", { name: "生成 1 条视频", exact: true }),
    );
    await waitFor(() => expect(mocks.videoGenerate).toHaveBeenCalledTimes(1));
    expect(mocks.videoGenerate.mock.calls[0][0]).toMatchObject({
      aspectRatio: "adaptive",
      prompt: expect.stringContaining("视频比例：跟随首帧图片"),
    });
    fireEvent.click(screen.getByRole("button", { name: "移除素材" }));
    expect(ratio.disabled).toBe(false);
    expect(ratio.value).toBe("9:16");
  });
  it("shares reference uploads across both entries and submits the remaining selection", async () => {
    mocks.generate.mockResolvedValue("synthetic-result");
    render(React.createElement(EcommerceWorkbench));
    await waitFor(() => expect(mocks.store.getSnapshot().ready).toBe(true));
    const input = screen.getByLabelText("选择商品原图文件") as HTMLInputElement;
    const picker = vi.spyOn(input, "click");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });
    const third = new File(["third"], "third.png", { type: "image/png" });
    const fourth = new File(["fourth"], "fourth.png", { type: "image/png" });
    const choose = (files: File[]) =>
      fireEvent.change(input, { target: { files } });
    fireEvent.click(
      screen.getByRole("button", { name: "从预览区上传商品原图", exact: true }),
    );
    expect(picker).toHaveBeenCalledTimes(1);
    choose([first]);
    expect(screen.getByAltText("上传素材 1")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /已选择 1\/3 张商品原图/ }),
    );
    expect(picker).toHaveBeenCalledTimes(2);
    choose([first, second]);
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "继续添加商品原图" }));
    expect(picker).toHaveBeenCalledTimes(3);
    choose([]); // Cancelling the picker keeps existing references.
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(2);
    choose([third, fourth]);
    expect(screen.getAllByAltText(/上传素材/)).toHaveLength(3);
    expect(screen.getByText(/多余图片未添加/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /已选择 3\/3 张商品原图/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "继续添加商品原图" }),
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
      screen.getByRole("button", { name: "生成 1 条视频", exact: true }),
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
