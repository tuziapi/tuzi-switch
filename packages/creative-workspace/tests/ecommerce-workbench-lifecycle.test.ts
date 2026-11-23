import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), store: null as any }));
vi.mock("../upstream/packages/drawnix/src/hooks/use-runtime-models", () => ({
  useSelectableModels: () => [
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
  generateEcommerceVideo: vi.fn(),
  resolveEcommerceModelRef: (modelId: string) => ({ modelId }),
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

beforeEach(() => {
  let objectUrlId = 0;
  mocks.generate.mockReset();
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
