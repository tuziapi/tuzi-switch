import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexConfigSection } from "@/components/providers/forms/CodexConfigSections";

vi.mock("@/components/JsonEditor", () => ({
  default: () => <div data-testid="json-editor" />,
}));

describe("CodexConfigSection", () => {
  it("enables the 1M context window with a default compact limit", () => {
    const onChange = vi.fn();
    render(
      <CodexConfigSection
        value={'model = "gpt-5.5"\n'}
        onChange={onChange}
        useCommonConfig={false}
        onCommonConfigToggle={() => {}}
        onEditCommonConfig={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "codexConfig.contextWindow1M" }),
    );

    const config = onChange.mock.lastCall?.[0] as string;
    expect(config).toContain("model_context_window = 1000000");
    expect(config).toContain("model_auto_compact_token_limit = 900000");
  });
});
