import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "@/components/AppSwitcher";

vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));

describe("T12 tool navigation compatibility", () => {
  it("returns to the previous tool from the account without storing account as a tool", () => {
    const onSwitch = vi.fn();
    const onSelectAccount = vi.fn();
    localStorage.setItem("tuzi-switch-last-app", "claude");
    const { rerender } = render(
      <AppSwitcher
        activeApp="claude"
        onSwitch={onSwitch}
        onSelectAccount={onSelectAccount}
      />,
    );
    const account = screen.getByRole("button", { name: "account.title" });
    expect(screen.getAllByRole("button")[0]).toBe(account);
    fireEvent.click(account);
    expect(onSelectAccount).toHaveBeenCalledOnce();
    expect(localStorage.getItem("tuzi-switch-last-app")).toBe("claude");
    rerender(
      <AppSwitcher
        activeApp="claude"
        onSwitch={onSwitch}
        onSelectAccount={onSelectAccount}
        accountSelected
        compact
      />,
    );
    expect(account).toHaveAttribute("aria-current", "page");
    expect(account).toHaveAttribute("title", "account.title");
    const claude = screen.getByRole("button", { name: "Claude" });
    expect(claude).not.toHaveAttribute("aria-current");
    expect(claude).toHaveAttribute("title", "Claude");
    fireEvent.click(claude);
    expect(onSwitch).toHaveBeenCalledWith("claude");
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(onSwitch).toHaveBeenLastCalledWith("codex");
    expect(localStorage.getItem("tuzi-switch-last-app")).toBe("codex");
  });

  it("retains all seven tools without account credentials", () => {
    const onSwitch = vi.fn();
    render(<AppSwitcher activeApp="claude" onSwitch={onSwitch} />);
    for (const [label, id] of [
      ["Claude", "claude"],
      ["Claude Desktop", "claude-desktop"],
      ["Codex", "codex"],
      ["Gemini", "gemini"],
      ["OpenCode", "opencode"],
      ["OpenClaw", "openclaw"],
      ["Hermes", "hermes"],
    ]) {
      const button = screen.getByRole("button", { name: label });
      fireEvent.click(button);
      if (id !== "claude") expect(onSwitch).toHaveBeenLastCalledWith(id);
    }
    expect(onSwitch).toHaveBeenCalledTimes(6);
  });
});
