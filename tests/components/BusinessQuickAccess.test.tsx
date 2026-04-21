import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type {
  ClaudeInstallerStatus,
  InstallerActionResult,
} from "@/lib/api/installer";
import type { Provider } from "@/types";
import { BusinessQuickAccess } from "@/components/BusinessQuickAccess";

type ProvidersStore = {
  providers: Record<string, Provider>;
  currentProviderId: string;
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createClaudeProvider(
  id: string,
  name: string,
  baseUrl: string,
  apiKey: string,
): Provider {
  return {
    id,
    name,
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_API_KEY: apiKey,
      },
    },
    category: "custom",
    createdAt: 1,
    sortIndex: id === "gac-claude-route" ? 1 : 2,
    notes: "test",
    meta: {
      businessLine: id === "gac-claude-route" ? "gac" : "tuzi",
    },
    websiteUrl: baseUrl,
  };
}

const claudeApiKey = "sk-tuzi-key";
const gacApiKey = "sk-gac-key";
const oldClaudeStatus: ClaudeInstallerStatus = {
  installed: true,
  version: "2.1.114",
  latest_version: "2.1.114",
  resolved_version: "2.1.114",
  current_route: "gaccode",
  route_file_current_route: "gaccode",
  effective_base_url: "https://gaccode.com/claudecode",
  resolved_executable_path: "/mock/claude",
  resolved_package_name: "@anthropic-ai/claude-code",
  resolved_variant: "original",
  variant_conflict: false,
  route_file_exists: true,
  settings_file_exists: true,
  sources_conflict: true,
  routes: [
    {
      name: "gaccode",
      base_url: "https://gaccode.com/claudecode",
      has_key: true,
      is_current: true,
      api_key_masked: "sk-gac****",
    },
    {
      name: "tu-zi",
      base_url: "https://api.tu-zi.com",
      has_key: true,
      is_current: false,
      api_key_masked: "sk-tuzi****",
    },
  ],
  env_summary: {
    anthropic_api_key_masked: "sk-gac****",
    anthropic_base_url: "https://gaccode.com/claudecode",
    anthropic_api_token_set: false,
  },
  settings_summary: {
    anthropic_api_key_masked: "sk-gac****",
    anthropic_base_url: "https://gaccode.com/claudecode",
    anthropic_auth_token_set: false,
  },
};

const newClaudeStatus: ClaudeInstallerStatus = {
  ...oldClaudeStatus,
  current_route: "tu-zi",
  route_file_current_route: "tu-zi",
  effective_base_url: "https://api.tu-zi.com",
  sources_conflict: false,
  routes: [
    {
      name: "gaccode",
      base_url: "https://gaccode.com/claudecode",
      has_key: true,
      is_current: false,
      api_key_masked: "sk-gac****",
    },
    {
      name: "tu-zi",
      base_url: "https://api.tu-zi.com",
      has_key: true,
      is_current: true,
      api_key_masked: "sk-tuzi****",
    },
  ],
  env_summary: {
    anthropic_api_key_masked: "sk-tuzi****",
    anthropic_base_url: "https://api.tu-zi.com",
    anthropic_api_token_set: false,
  },
  settings_summary: {
    anthropic_api_key_masked: "sk-tuzi****",
    anthropic_base_url: "https://api.tu-zi.com",
    anthropic_auth_token_set: false,
  },
};

let claudeStore: ProvidersStore;
let nextClaudeStatusDeferred: ReturnType<
  typeof createDeferred<ClaudeInstallerStatus>
> | null = null;
let claudeStatusCallCount = 0;

function installDefaultClaudeStatusMock() {
  installerApiMock.getClaudeStatus.mockImplementation(async () => {
    claudeStatusCallCount += 1;
    if (claudeStatusCallCount === 1) {
      return oldClaudeStatus;
    }
    if (nextClaudeStatusDeferred) {
      return nextClaudeStatusDeferred.promise;
    }
    return newClaudeStatus;
  });
}

const installerSuccess: InstallerActionResult = {
  success: true,
  message: "ok",
  error: null,
  stdout: "",
  stderr: "",
  restart_required: false,
};

const { providersApiMock, installerApiMock } = vi.hoisted(() => ({
  providersApiMock: {
    getAll: vi.fn(async (appId: string) => {
      if (appId !== "claude") return {};
      return claudeStore.providers;
    }),
    getCurrent: vi.fn(async (appId: string) => {
      if (appId !== "claude") return "";
      return claudeStore.currentProviderId;
    }),
    add: vi.fn(async (provider: Provider, appId: string) => {
      if (appId === "claude") {
        claudeStore.providers[provider.id] = provider;
      }
      return true;
    }),
    update: vi.fn(
      async (provider: Provider, appId: string, originalId?: string) => {
        if (appId === "claude") {
          if (originalId && originalId !== provider.id) {
            delete claudeStore.providers[originalId];
          }
          claudeStore.providers[provider.id] = provider;
        }
        return true;
      },
    ),
    switch: vi.fn(async (id: string, appId: string) => {
      if (appId === "claude") {
        claudeStore.currentProviderId = id;
      }
      return { warnings: [] };
    }),
  },
  installerApiMock: {
    getClaudeStatus: vi.fn(),
    installClaudeCode: vi.fn(async () => installerSuccess),
    upgradeClaudeCode: vi.fn(),
    switchClaudeVariant: vi.fn(),
    getCodexStatus: vi.fn(async () => ({
      installed: false,
      version: null,
      latest_version: null,
      resolved_version: null,
      install_type: null,
      current_route: null,
      resolved_executable_path: null,
      resolved_package_name: null,
      resolved_variant: null,
      variant_conflict: false,
      state_file_exists: false,
      config_file_exists: false,
      routes: [],
      env_summary: {
        codex_api_key_masked: null,
      },
    })),
    installCodex: vi.fn(),
    upgradeCodex: vi.fn(),
    switchCodexVariant: vi.fn(),
    getGeminiStatus: vi.fn(async () => ({
      installed: false,
      version: null,
      latest_version: null,
      resolved_version: null,
      install_type: null,
      current_route: null,
      resolved_executable_path: null,
      resolved_package_name: null,
      resolved_variant: null,
      variant_conflict: false,
      env_file_exists: false,
      settings_file_exists: false,
      routes: [],
      env_summary: {
        gemini_api_key_masked: null,
        google_gemini_base_url: null,
        gemini_model: null,
      },
    })),
    installGemini: vi.fn(),
    upgradeGemini: vi.fn(),
    switchGeminiVariant: vi.fn(),
  },
}));

vi.mock("@/lib/api/providers", () => ({
  providersApi: providersApiMock,
}));

vi.mock("@/lib/api/installer", () => ({
  installerApi: installerApiMock,
}));

vi.mock("@/lib/api/openclaw", () => ({
  openclawApi: {
    setAgentsDefaults: vi.fn(),
    setTools: vi.fn(),
  },
}));

vi.mock("@/hooks/useOpenClaw", () => ({
  openclawKeys: {
    liveProviderIds: () => ["openclaw", "live-provider-ids"],
    defaultModel: () => ["openclaw", "default-model"],
    agentsDefaults: () => ["openclaw", "agents-defaults"],
    tools: () => ["openclaw", "tools"],
    health: () => ["openclaw", "health"],
  },
  useOpenClawDefaultModel: () => ({ data: undefined }),
  useOpenClawAgentsDefaults: () => ({ data: undefined }),
  useOpenClawTools: () => ({ data: undefined }),
  useOpenClawLiveProviderIds: () => ({ data: [] }),
  useOpenClawHealth: () => ({ data: [] }),
}));

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );

  return {
    ...result,
    queryClient,
    rerenderWithClient(nextUi: ReactElement) {
      return result.rerender(
        <QueryClientProvider client={queryClient}>
          {nextUi}
        </QueryClientProvider>,
      );
    },
  };
}

describe("BusinessQuickAccess", () => {
  beforeEach(() => {
    claudeStore = {
      providers: {
        "gac-claude-route": createClaudeProvider(
          "gac-claude-route",
          "Claude · gac 线路",
          "https://gaccode.com/claudecode",
          gacApiKey,
        ),
        "tuzi-claude-route": createClaudeProvider(
          "tuzi-claude-route",
          "Claude · 兔子线路",
          "https://api.tu-zi.com",
          claudeApiKey,
        ),
      },
      currentProviderId: "gac-claude-route",
    };
    nextClaudeStatusDeferred = null;
    claudeStatusCallCount = 0;
    providersApiMock.getAll.mockClear();
    providersApiMock.getCurrent.mockClear();
    providersApiMock.add.mockClear();
    providersApiMock.update.mockClear();
    providersApiMock.switch.mockClear();
    installerApiMock.getClaudeStatus.mockClear();
    installerApiMock.installClaudeCode.mockClear();
    installDefaultClaudeStatusMock();
  });

  it("keeps Claude quick access on the old route until status and providers refresh complete together", async () => {
    renderWithQueryClient(<BusinessQuickAccess appId="claude" />);

    await waitFor(() => {
      expect(screen.getByText("Claude 兔子快速接入")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/当前 provider 仍停留在 Claude · 兔子线路/),
    ).not.toBeInTheDocument();

    nextClaudeStatusDeferred = createDeferred<ClaudeInstallerStatus>();

    fireEvent.click(screen.getByRole("button", { name: /Claude · 兔子线路/ }));
    fireEvent.change(screen.getByPlaceholderText("输入兔子 API Key"), {
      target: { value: claudeApiKey },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即配置" }));

    await waitFor(() => {
      expect(installerApiMock.installClaudeCode).toHaveBeenCalledWith(
        "C",
        claudeApiKey,
      );
    });

    await waitFor(() => {
      expect(providersApiMock.switch).toHaveBeenCalledWith(
        "tuzi-claude-route",
        "claude",
        { skipBackfill: true },
      );
    });

    expect(
      screen.queryByText(/当前 provider 仍停留在 Claude · 兔子线路/),
    ).not.toBeInTheDocument();

    await act(async () => {
      nextClaudeStatusDeferred?.resolve(newClaudeStatus);
      await nextClaudeStatusDeferred?.promise;
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/检测到 Claude 本地配置来源不一致/),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByText(/当前 provider 仍停留在/),
    ).not.toBeInTheDocument();
  });

  it("refreshes Claude quick access when an external provider switch token changes", async () => {
    const view = renderWithQueryClient(
      <BusinessQuickAccess appId="claude" externalRefreshToken={0} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Claude 兔子快速接入")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("输入 gac API Key")).toBeInTheDocument();
    expect(installerApiMock.getClaudeStatus).toHaveBeenCalledTimes(1);

    claudeStore.currentProviderId = "tuzi-claude-route";

    view.rerenderWithClient(
      <BusinessQuickAccess appId="claude" externalRefreshToken={1} />,
    );

    await waitFor(() => {
      expect(installerApiMock.getClaudeStatus).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("输入兔子 API Key"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/检测到 Claude 本地配置来源不一致/),
    ).not.toBeInTheDocument();
  });

  it("keeps Claude aligned to the current original provider even when sources conflict", async () => {
    claudeStore.currentProviderId = "tuzi-claude-route";
    installerApiMock.getClaudeStatus.mockImplementation(async () => ({
      ...oldClaudeStatus,
      current_route: "gaccode",
      route_file_current_route: "gaccode",
      effective_base_url: "https://gaccode.com/claudecode",
      sources_conflict: true,
    }));

    renderWithQueryClient(<BusinessQuickAccess appId="claude" />);

    await waitFor(() => {
      expect(screen.getByText("Claude 兔子快速接入")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("输入兔子 API Key")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("输入 gac API Key"),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle("Claude · 兔子线路")).toBeInTheDocument();
    expect(screen.getByTitle("https://api.tu-zi.com")).toBeInTheDocument();
    expect(
      screen.getByText(/检测到 Claude 本地配置来源不一致/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/当前 provider 仍停留在 Claude · 兔子线路/),
    ).not.toBeInTheDocument();
  });

  it("shows a Claude runtime environment warning when the current process still inherits modified env", async () => {
    installerApiMock.getClaudeStatus.mockImplementation(async () => ({
      ...newClaudeStatus,
      process_env_route: "改版",
      runtime_env_conflict: true,
      process_env_summary: {
        anthropic_api_key_masked: null,
        anthropic_base_url: "https://gaccode.com/claudecode",
        anthropic_auth_token_set: true,
      },
    }));

    renderWithQueryClient(<BusinessQuickAccess appId="claude" />);

    await waitFor(() => {
      expect(screen.getByText("Claude 兔子快速接入")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /当前 app\/终端会话仍继承旧 Claude 环境；文件配置已切回原版/,
      ),
    ).toBeInTheDocument();
  });
});
