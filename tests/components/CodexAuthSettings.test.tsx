import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAuthSettings } from "@/components/settings/CodexAuthSettings";
import type { SettingsFormState } from "@/hooks/useSettings";
import type { CodexImageCompatStatus } from "@/lib/api/settings";

const refetchMock = vi.fn();
let status: CodexImageCompatStatus;

vi.mock("@/lib/query", () => ({
  useCodexImageCompatStatusQuery: () => ({
    data: status,
    refetch: refetchMock,
  }),
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    hasCodexUnifyHistoryBackup: vi.fn().mockResolvedValue(false),
    restoreCodexUnifiedHistory: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { reason?: string }) =>
      key === "settings.codexImageRenderCompatNotReady"
        ? `未就绪：${options?.reason}`
        : key,
  }),
}));

const baseStatus = (): CodexImageCompatStatus => ({
  requested: true,
  ready: true,
  reason: "ready",
  providerBaseUrl: "https://api.tu-zi.com/v1",
  providerEnvKey: "TUZI01_CODEX_API_KEY",
  liveBaseUrl: "http://127.0.0.1:15721/v1",
  imageKeyEnv: "TUZI_CODEX_IMAGE_API_KEY",
  imageUpstream: "https://api.tu-zi.com/coding",
  imageModel: "gpt-image-2",
  personalizationInstruction:
    "只要是生成图片相关的需求，都使用 API Key 中内置的 gpt-image-2 生成，接口地址使用 https://api.tu-zi.com/v1。",
});

function renderSettings(
  settings: Partial<SettingsFormState> = {},
  onChange = vi.fn(),
) {
  render(
    <CodexAuthSettings
      settings={settings as SettingsFormState}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("CodexAuthSettings 图片兼容模式", () => {
  beforeEach(() => {
    status = baseStatus();
    refetchMock.mockResolvedValue(undefined);
  });

  it("默认开启并展示实际生效配置，不显示 Key 明文", () => {
    renderSettings();

    expect(
      screen.getByRole("switch", {
        name: "settings.codexImageRenderCompat",
      }),
    ).toBeChecked();
    expect(screen.getByTestId("codex-image-compat-details")).toHaveTextContent(
      "https://api.tu-zi.com/v1",
    );
    expect(screen.getByTestId("codex-image-compat-details")).toHaveTextContent(
      "TUZI01_CODEX_API_KEY",
    );
    expect(screen.getByTestId("codex-image-compat-details")).toHaveTextContent(
      "http://127.0.0.1:15721/v1",
    );
    expect(screen.getByTestId("codex-image-compat-details")).toHaveTextContent(
      "https://api.tu-zi.com/coding",
    );
    expect(screen.getByTestId("codex-image-compat-details")).toHaveTextContent(
      "gpt-image-2",
    );
    expect(screen.queryByText(/sk-[A-Za-z0-9]/)).not.toBeInTheDocument();
  });

  it("未就绪时展示安全原因和已识别的配置", () => {
    status = {
      ...baseStatus(),
      ready: false,
      reason: "local_route_inactive",
      liveBaseUrl: null,
    };
    renderSettings({ codexImageRenderCompat: true });

    expect(screen.getByRole("status")).toHaveTextContent(
      "settings.codexImageRenderCompatReason.local_route_inactive",
    );
    expect(screen.getByTestId("codex-image-compat-details")).toHaveTextContent(
      "settings.codexImageRenderCompatDetails.waitingForRoute",
    );
  });

  it("就绪时不显示告警", () => {
    renderSettings({ codexImageRenderCompat: true });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("切换后保存并刷新只读状态", async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    renderSettings({ codexImageRenderCompat: true }, onChange);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings.codexImageRenderCompat",
      }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        codexImageRenderCompat: false,
      }),
    );
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
