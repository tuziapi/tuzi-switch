import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TuziSidebar } from "@/components/shell/TuziSidebar";
const props = {
  activeApp: "claude" as const,
  currentView: "skillsDiscovery",
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
  collapsed: true,
  onToggleCollapsed: vi.fn(),
  onSwitchApp: vi.fn(),
  onNavigate: vi.fn(),
  onOpenSettings: vi.fn(),
};
vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));
describe("collapsed sidebar navigation", () => {
  it("keeps seven tool buttons and account accessible without visible labels", () => {
    render(<TuziSidebar {...props} />);
    for (const name of [
      "Claude Code",
      "Claude Desktop",
      "Codex",
      "Gemini CLI",
      "OpenCode",
      "OpenClaw",
      "Hermes",
      "Grok Build",
      "Pi",
      "MiniMax Code",
      "navigation.account",
      "common.settings",
    ])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "skills.title" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(props.onSwitchApp).toHaveBeenCalledWith("codex");
    expect(props.onNavigate).toHaveBeenCalledWith("providers");
  });
  it("honors tool visibility without hiding global workspace actions", () => {
    render(
      <TuziSidebar
        {...props}
        activeApp="claude-desktop"
        visibleApps={{ ...props.visibleApps, gemini: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Gemini CLI" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "skills.title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sessionManager.title" }),
    ).toBeInTheDocument();
  });
  it.each(["providers", "grokbuild", "pi", "mcode"])(
    "keeps every global entry available from %s, expanded and collapsed",
    (currentView) => {
      const navigate = vi.fn();
      const { rerender } = render(
        <TuziSidebar
          {...props}
          currentView={currentView}
          collapsed={false}
          onNavigate={navigate}
        />,
      );
      const entries = [
        ["mcp.title", "mcp"],
        ["skills.title", "skills"],
        ["navigation.prompts", "prompts"],
        ["sessionManager.title", "sessions"],
        ["navigation.auth", "auth"],
        ["navigation.localUsage", "usage"],
        ["agents.title", "agents"],
        ["统一供应商", "universal"],
      ];
      for (const [label, view] of entries) {
        fireEvent.click(screen.getByRole("button", { name: label }));
        expect(navigate).toHaveBeenLastCalledWith(view);
      }
      expect(
        screen.queryByText("navigation.comingSoon"),
      ).not.toBeInTheDocument();
      rerender(
        <TuziSidebar
          {...props}
          currentView="auth"
          collapsed
          onNavigate={navigate}
        />,
      );
      for (const [label] of entries)
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "navigation.auth" }),
      ).toHaveAttribute("aria-current", "page");
    },
  );
});
