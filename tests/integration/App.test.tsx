import { Suspense, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { disconnectedAccount } from "@/lib/api/account";
import { providersApi } from "@/lib/api/providers";
import {
  deleteProvider as deleteProviderState,
  resetProviderState,
  setCurrentProviderId,
  setLiveProviderIds,
  setProviders,
} from "../msw/state";
import { emitTauriEvent } from "../msw/tauriMocks";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/providers/ProviderList", () => ({
  ProviderList: ({
    providers,
    currentProviderId,
    onSwitch,
    onEdit,
    onDelete,
    onDuplicate,
    onConfigureUsage,
    onRemoveFromConfig,
    onClearConfig,
    onOpenWebsite,
    onCreate,
    focusRequest,
  }: any) => (
    <div>
      <div data-testid="focused-provider">{focusRequest?.providerId}</div>
      <div data-testid="provider-list">{JSON.stringify(providers)}</div>
      <div data-testid="current-provider">{currentProviderId}</div>
      <button onClick={() => onSwitch(providers[currentProviderId])}>
        switch
      </button>
      <button onClick={() => onEdit(providers[currentProviderId])}>edit</button>
      <button onClick={() => onDuplicate(providers[currentProviderId])}>
        duplicate
      </button>
      <button onClick={() => onConfigureUsage(providers[currentProviderId])}>
        usage
      </button>
      <button onClick={() => onDelete?.(providers[currentProviderId])}>
        delete
      </button>
      {onRemoveFromConfig && (
        <button
          onClick={() => onRemoveFromConfig(providers[currentProviderId])}
        >
          remove-config
        </button>
      )}
      {onClearConfig && (
        <button onClick={() => onClearConfig(providers[currentProviderId])}>
          clear-config
        </button>
      )}
      <button onClick={() => onOpenWebsite("https://example.com")}>
        open-website
      </button>
      <button onClick={() => onCreate?.()}>create</button>
    </div>
  ),
}));

vi.mock("@/components/providers/AddProviderDialog", () => ({
  AddProviderDialog: ({ open, onOpenChange, onSubmit, appId }: any) =>
    open ? (
      <div data-testid="add-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              name: `New ${appId} Provider`,
              settingsConfig: {},
              category: "custom",
              sortIndex: 99,
            })
          }
        >
          confirm-add
        </button>
        <button onClick={() => onOpenChange(false)}>close-add</button>
      </div>
    ) : null,
}));

vi.mock("@/components/providers/EditProviderDialog", () => ({
  EditProviderDialog: ({ open, provider, onSubmit, onOpenChange }: any) =>
    open ? (
      <div data-testid="edit-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              provider: {
                ...provider,
                name: `${provider.name}-edited`,
              },
              originalId: provider.id,
            })
          }
        >
          confirm-edit
        </button>
        <button onClick={() => onOpenChange(false)}>close-edit</button>
      </div>
    ) : null,
}));

vi.mock("@/components/UsageScriptModal", () => ({
  default: ({ isOpen, provider, onSave, onClose }: any) =>
    isOpen ? (
      <div data-testid="usage-modal">
        <span data-testid="usage-provider">{provider?.id}</span>
        <button onClick={() => onSave("script-code")}>save-script</button>
        <button onClick={() => onClose()}>close-usage</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <button onClick={() => onConfirm()}>confirm-action</button>
        <button onClick={() => onCancel()}>cancel-delete</button>
      </div>
    ) : null,
}));

vi.mock("@/components/AppSwitcher", () => ({
  AppSwitcher: ({
    activeApp,
    onSwitch,
    onSelectAccount,
    accountSelected,
  }: any) => (
    <div data-testid="app-switcher">
      <button
        onClick={onSelectAccount}
        aria-current={accountSelected ? "page" : undefined}
      >
        account.title
      </button>
      <span>{activeApp}</span>
      <button onClick={() => onSwitch("claude")}>switch-claude</button>
      <button onClick={() => onSwitch("codex")}>switch-codex</button>
      <button onClick={() => onSwitch("openclaw")}>switch-openclaw</button>
    </div>
  ),
}));

vi.mock("@/components/UpdateBadge", () => ({
  UpdateBadge: ({ onClick }: any) => (
    <button onClick={onClick}>update-badge</button>
  ),
}));

vi.mock("@/components/mcp/McpPanel", () => ({
  default: ({ open, onOpenChange }: any) =>
    open ? (
      <div data-testid="mcp-panel">
        <button onClick={() => onOpenChange(false)}>close-mcp</button>
      </div>
    ) : (
      <button onClick={() => onOpenChange(true)}>open-mcp</button>
    ),
}));

const renderApp = (AppComponent: ComponentType) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading">loading</div>}>
        <AppComponent />
      </Suspense>
    </QueryClientProvider>,
  );
};

// Keep real account pages for existing tests; this fixture isolates App's
// navigation after a successful tool transaction without writing tool files.
vi.mock("@/components/account/AccountPage", async (original) => {
  const real =
    await original<typeof import("@/components/account/AccountPage")>();
  return {
    ...real,
    AccountPage: (props: any) =>
      props.account.state.identity?.username === "synthetic-b10" ? (
        <button onClick={() => props.onConfigureKey({ id: "synthetic-key" })}>
          configure-synthetic-key
        </button>
      ) : (
        <real.AccountPage {...props} />
      ),
  };
});
vi.mock("@/components/account/ConfigureTool", () => ({
  ConfigureTool: ({ onReady, state }: any) => (
    <button
      onClick={() => onReady({ appId: "codex", generation: state.generation })}
    >
      prepare-synthetic-config
    </button>
  ),
}));
vi.mock("@/components/providers/TuziProviderDialog", async (original) => ({
  ...(await original<
    typeof import("@/components/providers/TuziProviderDialog")
  >()),
  TuziProviderDialog: ({ onSaved }: any) => (
    <button onClick={() => onSaved("codex-1")}>save-synthetic-config</button>
  ),
}));

describe("App integration with MSW", () => {
  beforeEach(() => {
    localStorage.removeItem("tuzi-switch-last-view");
    localStorage.removeItem("tuzi-switch-last-app");
    server.use(
      http.post("http://tauri.local/account_get_state", () =>
        HttpResponse.json(disconnectedAccount),
      ),
      http.post("http://tauri.local/get_current_import_urls", () =>
        HttpResponse.json([]),
      ),
      http.post("http://tauri.local/account_take_open_request", () =>
        HttpResponse.json(false),
      ),
    );
    resetProviderState();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it.each([null, "providers", "settings"])(
    "starts on account despite saved view %s and keeps tools usable",
    async (savedView) => {
      if (savedView) localStorage.setItem("tuzi-switch-last-view", savedView);
      localStorage.setItem("tuzi-switch-last-app", "codex");
      const { default: App } = await import("@/App");
      renderApp(App);
      await screen.findByTestId("app-switcher");
      const notice = await screen.findByRole("button", {
        name: "firstRunNotice.confirm",
      });
      fireEvent.click(notice);
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "account.status.disconnected",
        ),
      );
      expect(screen.getByText("account.connectRequired")).toBeInTheDocument();
      expect(screen.queryByTestId("provider-list")).not.toBeInTheDocument();
      expect(localStorage.getItem("tuzi-switch-last-app")).toBe("codex");
      expect(screen.getByText("兔子助手")).toBeInTheDocument();
      expect(screen.getByTestId("app-switcher")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "account.tools" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("switch-claude"));
      expect(await screen.findByTestId("provider-list")).toBeInTheDocument();
      fireEvent.click(screen.getByText("switch-openclaw"));
      expect(await screen.findByTitle("workspace.manage")).toBeInTheDocument();
      fireEvent.click(screen.getByText("switch-claude"));
      expect(await screen.findByTitle("skills.manage")).toBeInTheDocument();
      expect(screen.getByTitle("sessionManager.title")).toBeInTheDocument();
    },
  );

  it("keeps saved configuration focused without an account return banner", async () => {
    server.use(
      http.post("http://tauri.local/account_get_state", () =>
        HttpResponse.json({
          ...disconnectedAccount,
          status: "connected",
          generation: 10,
          identity: {
            userId: "synthetic-user",
            username: "synthetic-b10",
            displayName: "Synthetic B10",
            connectionId: "synthetic-b10",
          },
        }),
      ),
    );
    const { default: App } = await import("@/App");
    renderApp(App);
    await screen.findByTestId("app-switcher");
    fireEvent.click(
      await screen.findByRole("button", { name: "firstRunNotice.confirm" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(await screen.findByText("configure-synthetic-key"));
    fireEvent.click(await screen.findByText("prepare-synthetic-config"));
    expect(
      screen.queryByText("配置保存后，可在此启用或检查"),
    ).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("save-synthetic-config"));
    await waitFor(() =>
      expect(screen.getByTestId("focused-provider")).toHaveTextContent(
        "codex-1",
      ),
    );
    expect(screen.queryByText("← 返回兔子账户")).not.toBeInTheDocument();
    expect(screen.queryByText(/已定位配置：/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "account.title" }));
    expect(
      await screen.findByText("configure-synthetic-key"),
    ).toBeInTheDocument();
  });

  it("covers basic provider flows via real hooks", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);
    fireEvent.click(await screen.findByText("switch-claude"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    fireEvent.click(screen.getByText("switch-codex"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "codex-1",
      ),
    );

    fireEvent.click(screen.getByText("usage"));
    expect(screen.getByTestId("usage-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-script"));
    fireEvent.click(screen.getByText("close-usage"));

    fireEvent.click(screen.getByText("create"));
    expect(screen.getByTestId("add-provider-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-add"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /New codex Provider/,
      ),
    );

    fireEvent.click(screen.getByText("edit"));
    expect(screen.getByTestId("edit-provider-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-edit"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /-edited/,
      ),
    );

    fireEvent.click(screen.getByText("switch"));
    fireEvent.click(screen.getByText("duplicate"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(/copy/),
    );

    fireEvent.click(screen.getByText("open-website"));

    emitTauriEvent("provider-switched", {
      appType: "codex",
      providerId: "codex-2",
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("shows toast when auto sync fails in background", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);
    fireEvent.click(await screen.findByText("switch-claude"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    emitTauriEvent("webdav-sync-status-updated", {
      source: "auto",
      status: "error",
      error: "network timeout",
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
  });

  it("confirms provider action against the original app after switching apps", async () => {
    const clearLiveConfigSpy = vi
      .spyOn(providersApi, "clearLiveConfig")
      .mockImplementationOnce(async (providerId, appId) => {
        deleteProviderState(appId, providerId);
        return true;
      });

    const { default: App } = await import("@/App");
    renderApp(App);
    fireEvent.click(await screen.findByText("switch-claude"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    fireEvent.click(screen.getByText("switch-codex"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "codex-1",
      ),
    );

    fireEvent.click(screen.getByText("clear-config"));
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("switch-claude"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    fireEvent.click(screen.getByText("confirm-action"));

    await waitFor(() => {
      expect(clearLiveConfigSpy).toHaveBeenCalledWith("codex-1", "codex");
    });

    expect(clearLiveConfigSpy).toHaveBeenCalledTimes(1);

    clearLiveConfigSpy.mockRestore();
  });

  it("shows an error and keeps the dialog open when provider action fails", async () => {
    const clearLiveConfigSpy = vi
      .spyOn(providersApi, "clearLiveConfig")
      .mockRejectedValueOnce(new Error("clear failed"));

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(screen.getByText("switch-codex"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "codex-1",
      ),
    );

    fireEvent.click(screen.getByText("clear-config"));
    fireEvent.click(await screen.findByText("confirm-action"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("clear failed"),
        { closeButton: true },
      );
    });
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();

    clearLiveConfigSpy.mockRestore();
  });

  it("duplicates openclaw providers with a generated key that avoids live-only ids", async () => {
    setProviders("openclaw", {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");
    setLiveProviderIds("openclaw", ["deepseek-copy"]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(screen.getByText("switch-openclaw"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "deepseek",
      ),
    );

    expect(screen.getByText("remove-config")).toBeInTheDocument();
    expect(screen.queryByText("clear-config")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("duplicate"));

    await waitFor(() => {
      const providerList = screen.getByTestId("provider-list").textContent;
      expect(providerList).toContain("deepseek-copy-2");
      expect(providerList).toContain("DeepSeek copy");
    });

    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Provider key is required for openclaw"),
    );
  });

  it("shows toast when duplicate cannot load live provider ids", async () => {
    setProviders("openclaw", {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");

    const liveIdsSpy = vi
      .spyOn(providersApi, "getOpenClawLiveProviderIds")
      .mockRejectedValueOnce(new Error("broken config"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(screen.getByText("switch-openclaw"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "deepseek",
      ),
    );

    fireEvent.click(screen.getByText("duplicate"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("读取配置中的供应商标识失败"),
      );
    });

    expect(screen.getByTestId("provider-list").textContent).not.toContain(
      "deepseek-copy",
    );

    liveIdsSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
