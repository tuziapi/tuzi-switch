import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceScope } from "@/components/shell/WorkspaceScope";

describe("workspace support scope", () => {
  it.each(["claude-desktop", "openclaw", "grokbuild", "pi", "mcode"] as const)(
    "requires an explicit Skills target from %s",
    (origin) => {
      const onChange = vi.fn();
      render(
        <WorkspaceScope
          feature="skills"
          origin={origin}
          target={null}
          onTargetChange={onChange}
        />,
      );
      expect(
        screen.getByText("navigation.unsupportedOrigin"),
      ).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveValue("");
      expect(onChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole("option", { name: /Claude Desktop/ }),
      ).toBeDisabled();
      expect(screen.getByRole("option", { name: /OpenClaw/ })).toBeDisabled();
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "codex" },
      });
      expect(onChange).toHaveBeenCalledWith("codex");
    },
  );
  it("retains OpenClaw prompt support while disabling new native tools", () => {
    render(
      <WorkspaceScope
        feature="prompts"
        origin="openclaw"
        target="openclaw"
        onTargetChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("navigation.unsupportedOrigin"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("openclaw");
    expect(screen.getByRole("option", { name: /OpenClaw/ })).not.toBeDisabled();
    expect(screen.getByRole("option", { name: /Grok Build/ })).toBeDisabled();
  });
});
