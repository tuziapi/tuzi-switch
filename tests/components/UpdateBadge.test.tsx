import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpdateBadge } from "@/components/UpdateBadge";
const state = {
  hasUpdate: true,
  updateInfo: { availableVersion: "1.5.2" },
  updateHandle: { manual: false },
  openUpdateDialog: vi.fn(),
  downloadUpdate: vi.fn(),
};
vi.mock("@/contexts/UpdateContext", () => ({ useUpdate: () => state }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "更新" }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.hasUpdate = true;
  state.updateHandle.manual = false;
});
describe("global update entry", () => {
  it("opens shared dialog instead of starting an independent install", () => {
    render(<UpdateBadge />);
    fireEvent.click(screen.getByRole("button"));
    expect(state.openUpdateDialog).toHaveBeenCalledOnce();
    expect(state.downloadUpdate).not.toHaveBeenCalled();
  });
  it("retains manual download for legacy acceptance channel", () => {
    state.updateHandle.manual = true;
    render(<UpdateBadge />);
    fireEvent.click(screen.getByRole("button"));
    expect(state.downloadUpdate).toHaveBeenCalledOnce();
    expect(state.openUpdateDialog).not.toHaveBeenCalled();
  });
  it("hides without update", () => {
    state.hasUpdate = false;
    render(<UpdateBadge />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
