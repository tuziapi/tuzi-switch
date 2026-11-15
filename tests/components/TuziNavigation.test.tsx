import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TuziNavigation } from "@/components/shell/TuziNavigation";

vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));
const props = {
  activeApp: "codex" as const,
  currentView: "creative",
  visibleApps: {
    claude: true,
    "claude-desktop": true,
    codex: true,
    gemini: true,
    opencode: true,
    openclaw: true,
    hermes: true,
  },
  topOffset: 28,
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  onSwitchApp: vi.fn(),
  onNavigate: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe("creative assistant dropdown", () => {
  it.each([false, true])(
    "preserves the original sidebar preference (%s)",
    (collapsed) => {
      const toggle = vi.fn();
      const view = render(
        <TuziNavigation
          {...props}
          collapsed={collapsed}
          onToggleCollapsed={toggle}
        />,
      );
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "兔子助手导航" }));
      expect(screen.getByRole("button", { name: "Codex" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "向上收起导航" }));
      expect(toggle).not.toHaveBeenCalled();
      view.rerender(
        <TuziNavigation
          {...props}
          currentView="providers"
          collapsed={collapsed}
          onToggleCollapsed={toggle}
        />,
      );
      expect(
        screen.getByRole("button", {
          name: collapsed ? "展开侧栏" : "收起侧栏",
        }),
      ).toBeVisible();
    },
  );

  it("routes tool and settings actions through existing handlers and dismisses", async () => {
    const navigate = vi.fn();
    const switchApp = vi.fn();
    const settings = vi.fn();
    render(
      <TuziNavigation
        {...props}
        onNavigate={navigate}
        onSwitchApp={switchApp}
        onOpenSettings={settings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "兔子助手导航" }));
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(switchApp).toHaveBeenCalledWith("codex");
    expect(navigate).toHaveBeenCalledWith("providers");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "兔子助手导航" }));
    fireEvent.click(screen.getByRole("button", { name: "common.settings" }));
    expect(settings).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
