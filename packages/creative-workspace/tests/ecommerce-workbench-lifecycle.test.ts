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

const mocks = vi.hoisted(() => ({ generate: vi.fn(), key: "synthetic-key" }));
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
    provider: { apiKey: mocks.key, profileName: "Synthetic" },
    binding: { submitPath: "/images/edits" },
  }),
}));
vi.mock("../src/ecommerce-generation", () => ({
  generateEcommerceImage: mocks.generate,
  generateEcommerceVideo: vi.fn(),
  resolveEcommerceModelRef: (modelId: string) => ({ modelId }),
}));
import { EcommerceWorkbench } from "../src/EcommerceWorkbench";

beforeEach(() => {
  mocks.generate.mockReset();
  mocks.key = "synthetic-key";
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => "blob:synthetic",
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const ui = render(React.createElement(EcommerceWorkbench));
  const input = ui.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: {
      files: [new File(["synthetic"], "product.png", { type: "image/png" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  return ui;
}

describe("ecommerce image UI lifecycle", () => {
  it("bounds a stalled request and releases the UI without resubmitting", async () => {
    mocks.generate.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ui = setup();
    // FileReader completes through jsdom's real event loop.
    await act(async () => {
      await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    });
    expect(screen.getByRole("alert").textContent).toContain("等待图片结果超时");
    expect(mocks.generate.mock.calls[0][0].signal.aborted).toBe(true);
    expect(
      ui.container.querySelector<HTMLButtonElement>(".ecommerce-generate")!
        .disabled,
    ).toBe(false);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("shows waiting status, prevents duplicate submission, stops a stalled adapter and discards late output", async () => {
    let finish!: (value: string[]) => void;
    mocks.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const ui = setup();
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(ui.container.textContent).toContain("等待模型返回");
    expect(ui.container.textContent).not.toContain("8%");
    const submit = ui.container.querySelector<HTMLButtonElement>(
      ".ecommerce-generate",
    )!;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "停止等待" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("避免重复付费"),
    );
    expect(mocks.generate.mock.calls[0][0].signal.aborted).toBe(true);
    expect(submit.disabled).toBe(false);
    await act(async () => {
      finish(["https://example.invalid/late.png"]);
    });
    expect(
      ui.container.querySelector('img[src="https://example.invalid/late.png"]'),
    ).toBeNull();
  });

  it("shows the actual provider failure and restores the generate button", async () => {
    mocks.generate.mockRejectedValue(new Error("synthetic provider rejected"));
    setup();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "synthetic provider rejected",
      ),
    );
    expect(
      (screen.getByRole("button", { name: "生成图片" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("renders returned images and exits the waiting state", async () => {
    mocks.generate.mockResolvedValue(["https://example.invalid/result.png"]);
    const ui = setup();
    await waitFor(() =>
      expect(
        ui.container.querySelector(
          'img[src="https://example.invalid/result.png"]',
        ),
      ).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "停止等待" })).toBeNull();
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
