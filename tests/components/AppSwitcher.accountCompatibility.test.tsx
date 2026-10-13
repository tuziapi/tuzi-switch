import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "@/components/AppSwitcher";

vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));

describe("T12 tool navigation compatibility", () => {
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
