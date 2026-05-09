import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type {
  ClaudeInstallerStatus,
  CodexInstallerStatus,
  InstallerActionResult,
} from "@/lib/api/installer";
import type { Provider } from "@/types";
import { BusinessQuickAccess } from "@/components/BusinessQuickAccess";

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    value: () => false,
  });
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
  });
}

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

const codexStatusWithBuiltInRoutes: CodexInstallerStatus = {
  installed: true,
  version: "0.128.0",
  latest_version: "0.128.0",
  resolved_version: "0.128.0",
  install_type: "openai",
  current_route: "codex",
  resolved_executable_path: "/mock/codex",
  resolved_package_name: "@openai/codex",
  resolved_variant: "openai",
  variant_conflict: false,
  state_file_exists: true,
  config_file_exists: true,
  routes: [
    {
      name: "codex",
      base_url: "https://api.tu-zi.com/coding",
      has_key: true,
      is_current: true,
      api_key_masked: "sk-codex****",
      model_settings: {
        model: "gpt-5.5",
        model_reasoning_effort: "xhigh",
      },
    },
    {
      name: "tuzi",
      base_url: "https://api.tu-zi.com/v1",
      has_key: false,
      is_current: false,
      api_key_masked: null,
      model_settings: {
        model: "gpt-5.4",
        model_reasoning_effort: "medium",
      },
    },
    {
      name: "gac",
      base_url: "https://gaccode.com/codex/v1",
      has_key: false,
      is_current: false,
      api_key_masked: null,
      model_settings: {
        model: "gpt-5.4",
        model_reasoning_effort: "medium",
      },
    },
  ],
  env_summary: {
    codex_api_key_masked: "sk-codex****",
  },
};

let claudeStore: ProvidersStore;
let nextClaudeStatusDeferred: ReturnType<
  typeof createDeferred<ClaudeInstallerStatus>
> | null = null;
let claudeStatusCallCount = 0;
let codexStore: ProvidersStore;
const openclawApiMock = vi.hoisted(() => ({
  setAgentsDefaults: vi.fn(),
  setTools: vi.fn(),
}));

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

const missingNodeNpmResult: InstallerActionResult = {
  success: false,
  message: "未检测到 Node.js/npm，无法安装 CLI。是否允许自动安装？",
  error: "MISSING_NODE_NPM",
  stdout: "安装 CLI 需要 Node.js 和 npm。",
  stderr: "",
  restart_required: false,
};

const { providersApiMock, installerApiMock } = vi.hoisted(() => ({
  providersApiMock: {
    getAll: vi.fn(async (appId: string) => {
      if (appId === "openclaw") return {};
      if (appId === "codex") return codexStore.providers;
      if (appId !== "claude") return {};
      return claudeStore.providers;
    }),
    getCurrent: vi.fn(async (appId: string) => {
      if (appId === "openclaw") return "";
      if (appId === "codex") return codexStore.currentProviderId;
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
    getCodexStatus: vi.fn(async (): Promise<CodexInstallerStatus> => ({
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
  openclawApi: openclawApiMock,
}));

vi.mock("@/hooks/useOpenClaw", () => ({
  openclawKeys: {
    liveProviderIds: ["openclaw", "live-provider-ids"],
    defaultModel: ["openclaw", "default-model"],
    agentsDefaults: ["openclaw", "agents-defaults"],
    tools: ["openclaw", "tools"],
    health: ["openclaw", "health"],
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
    codexStore = {
      providers: {},
      currentProviderId: "",
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
    installerApiMock.installCodex.mockReset();
    installerApiMock.upgradeCodex.mockReset();
    installerApiMock.switchCodexVariant.mockReset();
    installerApiMock.installGemini.mockReset();
    installerApiMock.upgradeGemini.mockReset();
    installerApiMock.switchGeminiVariant.mockReset();
    openclawApiMock.setAgentsDefaults.mockReset();
    openclawApiMock.setTools.mockReset();
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
        undefined,
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

  it("uses the selected OpenClaw quick access model as primary and keeps the rest as fallbacks", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BusinessQuickAccess appId="openclaw" />);

    await waitFor(() => {
      expect(screen.getByText("OpenClaw 兔子快速接入")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /兔子 · Codex 线路/ }));
    await user.click(screen.getByLabelText("OpenClaw 默认模型"));
    await user.click(screen.getByRole("option", { name: "GPT-5.4" }));
    fireEvent.change(screen.getByPlaceholderText("输入兔子 API Key"), {
      target: { value: "sk-openclaw-key" },
    });
    await user.click(screen.getByRole("button", { name: "立即配置" }));

    await waitFor(() => {
      expect(openclawApiMock.setAgentsDefaults).toHaveBeenCalledWith(
        expect.objectContaining({
          model: {
            primary: "tuzi-openclaw-codex/gpt-5.4",
            fallbacks: ["tuzi-openclaw-codex/gpt-5.5"],
          },
          models: {
            "tuzi-openclaw-codex/gpt-5.4": { alias: "GPT-5.4" },
            "tuzi-openclaw-codex/gpt-5.5": { alias: "GPT-5.5" },
          },
        }),
      );
    });

    expect(providersApiMock.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tuzi-openclaw-codex",
        settingsConfig: expect.objectContaining({
          baseUrl: "https://api.tu-zi.com/v1",
          apiKey: "sk-openclaw-key",
          api: "openai-responses",
          models: [
            expect.objectContaining({ id: "gpt-5.4", name: "GPT-5.4" }),
            expect.objectContaining({ id: "gpt-5.5", name: "GPT-5.5" }),
          ],
        }),
      }),
      "openclaw",
      true,
    );
    expect(providersApiMock.switch).toHaveBeenCalledWith(
      "tuzi-openclaw-codex",
      "openclaw",
    );
  });

  it("asks before installing Node.js/npm and retries Codex configuration after confirmation", async () => {
    const user = userEvent.setup();
    installerApiMock.installCodex
      .mockResolvedValueOnce(missingNodeNpmResult)
      .mockResolvedValueOnce(installerSuccess);

    renderWithQueryClient(<BusinessQuickAccess appId="codex" />);

    await waitFor(() => {
      expect(screen.getByText("Codex 兔子快速接入")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("输入兔子 API Key"), {
      target: { value: "sk-codex-key" },
    });
    await user.click(screen.getByRole("button", { name: "立即配置" }));

    expect(await screen.findByText("需要安装 Node.js/npm")).toBeInTheDocument();
    expect(installerApiMock.installCodex).toHaveBeenCalledTimes(1);
    expect(installerApiMock.installCodex).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variant: "openai",
        allowDependencyInstall: undefined,
      }),
    );

    await user.click(screen.getByRole("button", { name: "自动安装并继续" }));

    await waitFor(() => {
      expect(installerApiMock.installCodex).toHaveBeenCalledTimes(2);
    });
    expect(installerApiMock.installCodex).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variant: "openai",
        allowDependencyInstall: true,
      }),
    );
  });

  it("does not retry Codex configuration when dependency installation is cancelled", async () => {
    const user = userEvent.setup();
    installerApiMock.installCodex.mockResolvedValueOnce(missingNodeNpmResult);

    renderWithQueryClient(<BusinessQuickAccess appId="codex" />);

    await waitFor(() => {
      expect(screen.getByText("Codex 兔子快速接入")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("输入兔子 API Key"), {
      target: { value: "sk-codex-key" },
    });
    await user.click(screen.getByRole("button", { name: "立即配置" }));

    expect(await screen.findByText("需要安装 Node.js/npm")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(
        screen.queryByText("需要安装 Node.js/npm"),
      ).not.toBeInTheDocument();
    });
    expect(installerApiMock.installCodex).toHaveBeenCalledTimes(1);
  });

  it("does not mark Codex routes as written when only installer routes exist", async () => {
    installerApiMock.getCodexStatus.mockResolvedValueOnce(
      codexStatusWithBuiltInRoutes,
    );
    codexStore = {
      providers: {
        "tuzi.coding": {
          id: "tuzi.coding",
          name: "Codex·粉色订阅",
          settingsConfig: {
            config:
              'model_provider = "codex"\n[model_providers.codex]\nbase_url = "https://api.tu-zi.com/coding"',
          },
          category: "custom",
          createdAt: 1,
          notes: "由兔子业务一键接入自动生成（粉色订阅）",
          websiteUrl: "https://api.tu-zi.com/coding",
        },
      },
      currentProviderId: "tuzi.coding",
    };

    renderWithQueryClient(<BusinessQuickAccess appId="codex" />);

    await waitFor(() => {
      expect(screen.getByText("Codex 兔子快速接入")).toBeInTheDocument();
    });

    expect(screen.getByTitle("Codex·粉色订阅")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Codex · 兔子线路/ }),
    ).toHaveTextContent("推荐");
    expect(
      screen.getByRole("button", { name: /Codex · gac 线路/ }),
    ).toHaveTextContent("可选");
    expect(
      screen.getByRole("button", { name: /Codex·粉色订阅/ }),
    ).toHaveTextContent("已接入");
  });

  it("marks a Codex route as written when an alternate provider card exists", async () => {
    installerApiMock.getCodexStatus.mockResolvedValueOnce({
      ...codexStatusWithBuiltInRoutes,
      current_route: "tuzi",
      routes: codexStatusWithBuiltInRoutes.routes.map((route) => ({
        ...route,
        is_current: route.name === "tuzi",
      })),
    });
    codexStore = {
      providers: {
        "tuzi.coding-alt-2": {
          id: "tuzi.coding-alt-2",
          name: "Codex·粉色订阅（附加 Key 2）",
          settingsConfig: {
            config:
              'model_provider = "codex"\n[model_providers.codex]\nbase_url = "https://api.tu-zi.com/coding"',
          },
          category: "custom",
          createdAt: 1,
          notes: "由兔子业务一键接入自动生成（粉色订阅）（附加 Key 2）",
          websiteUrl: "https://api.tu-zi.com/coding",
        },
      },
      currentProviderId: "",
    };

    renderWithQueryClient(<BusinessQuickAccess appId="codex" />);

    await waitFor(() => {
      expect(screen.getByText("Codex 兔子快速接入")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /Codex·粉色订阅/ }),
    ).toHaveTextContent("已写入");
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
