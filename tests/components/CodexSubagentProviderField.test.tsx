import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexSubagentProviderField } from "@/components/providers/forms/CodexSubagentProviderField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CodexSubagentProviderField", () => {
  it("selects a preset and can return to global inheritance", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CodexSubagentProviderField value="" onChange={onChange} />,
    );

    fireEvent.click(screen.getByTestId("codex-subagent-preset-12"));
    expect(onChange).toHaveBeenLastCalledWith("12");

    rerender(<CodexSubagentProviderField value="12" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("codex-subagent-inherit"));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("accepts a custom value", () => {
    const onChange = vi.fn();
    render(<CodexSubagentProviderField value="" onChange={onChange} />);

    fireEvent.change(screen.getByTestId("codex-subagent-provider-input"), {
      target: { value: "24" },
    });

    expect(onChange).toHaveBeenLastCalledWith("24");
  });
});
