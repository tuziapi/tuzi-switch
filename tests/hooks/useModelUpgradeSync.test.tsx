import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreativeAccountBridge } from "@tuzi/creative-workspace";
import { useModelUpgradeSync } from "@/features/creative/useModelUpgradeSync";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@tuzi/creative-workspace/model-sync", () => ({
  startModelUpgradeSync: mocks.start,
}));
const bridge = (generation: number) =>
  ({ state: { generation, status: "connected" } }) as CreativeAccountBridge;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.start.mockReturnValue({
    stop: mocks.stop,
    updateAccountBridge: mocks.update,
  });
});
afterEach(() => vi.useRealTimers());

describe("host background model discovery", () => {
  it("starts after startup delay with the latest account and tears down on unmount", async () => {
    const latest = bridge(2);
    const hook = renderHook(({ account }) => useModelUpgradeSync(account), {
      initialProps: { account: bridge(1) },
    });
    hook.rerender({ account: latest });
    expect(mocks.start).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith(latest);
    const next = bridge(3);
    hook.rerender({ account: next });
    expect(mocks.update).toHaveBeenCalledWith(next);
    hook.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
  it("does not start a disposed startup timer", async () => {
    const hook = renderHook(() => useModelUpgradeSync(bridge(1)));
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
