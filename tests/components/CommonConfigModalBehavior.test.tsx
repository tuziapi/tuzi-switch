import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GeminiConfigEditor from "@/components/providers/forms/GeminiConfigEditor";
import CodexConfigEditor from "@/components/providers/forms/CodexConfigEditor";

vi.mock("@/components/common/FullScreenPanel", () => ({
  FullScreenPanel: ({
    isOpen,
    title,
    onClose,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="common-config-panel">
        <button type="button" onClick={onClose}>
          panel-close
        </button>
        <h2>{title}</h2>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("@/components/JsonEditor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="mock-editor"
    />
  ),
}));

describe("Common config modals", () => {
  it("shows Codex common config controls and opens the editor", () => {
    const onToggle = vi.fn();

    render(
      <CodexConfigEditor
        authValue="{}"
        configValue={'model_provider = "custom"'}
        onAuthChange={() => {}}
        onConfigChange={() => {}}
        useCommonConfig={false}
        onCommonConfigToggle={onToggle}
        commonConfigSnippet={'approval_policy = "never"'}
        onCommonConfigSnippetChange={() => true}
        onCommonConfigErrorClear={() => {}}
        commonConfigError=""
        authError=""
        configError=""
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /codexConfig.writeCommonConfig|应用通用配置|写入通用配置/,
    });
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(true);

    fireEvent.click(
      screen.getByRole("button", {
        name: /codexConfig.editCommonConfig|编辑通用配置/,
      }),
    );
    expect(screen.getByTestId("common-config-panel")).toBeInTheDocument();
  });

  it("keeps Codex common config controls disabled while local data loads", () => {
    render(
      <CodexConfigEditor
        authValue="{}"
        configValue=""
        onAuthChange={() => {}}
        onConfigChange={() => {}}
        useCommonConfig={false}
        onCommonConfigToggle={() => {}}
        commonConfigSnippet=""
        onCommonConfigSnippetChange={() => true}
        onCommonConfigErrorClear={() => {}}
        commonConfigError=""
        authError=""
        configError=""
        isCommonConfigLoading
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: /codexConfig.writeCommonConfig|应用通用配置|写入通用配置/,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: /codexConfig.editCommonConfig|编辑通用配置/,
      }),
    ).toBeDisabled();
  });

  it("keeps the Gemini common config modal closed after user closes it with an error present", async () => {
    render(
      <GeminiConfigEditor
        envValue="{}"
        configValue="{}"
        onEnvChange={() => {}}
        onConfigChange={() => {}}
        useCommonConfig={false}
        onCommonConfigToggle={() => {}}
        commonConfigSnippet={`{"GEMINI_MODEL":"gemini-2.5-pro"}`}
        onCommonConfigSnippetChange={() => false}
        onCommonConfigErrorClear={() => {}}
        commonConfigError="Invalid JSON"
        envError=""
        configError=""
      />,
    );

    expect(screen.queryByTestId("common-config-panel")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /geminiConfig.editCommonConfig|编辑通用配置/,
      }),
    );

    expect(screen.getByTestId("common-config-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("common-config-panel"),
      ).not.toBeInTheDocument(),
    );
  });
});
