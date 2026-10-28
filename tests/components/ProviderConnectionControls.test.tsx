import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderConnectionControls } from "@/components/providers/ProviderConnectionControls";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  proxy: {
    isLoading: false,
    isTakeoverLoading: false,
    error: null as Error | null,
    isRunning: false,
    isPending: false,
    status: {
      active_targets: [] as { app_type: string; provider_name: string }[],
    },
    takeoverStatus: { codex: false },
    setTakeoverForApp: vi.fn().mockResolvedValue(undefined),
    startProxyServer: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/hooks/useProxyStatus", () => ({
  useProxyStatus: () => state.proxy,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}: ${options.name}` : key,
  }),
}));

function mount(routeEnabled = true) {
  const onOpenSettings = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["aggregation", "codex"], {
    enabled: false,
    needsRecovery: false,
    plan: { defaultProviderId: "", models: [] },
  });
  render(
    <QueryClientProvider client={client}>
      <ProviderConnectionControls
        appId="codex"
        providers={{
          demo: {
            id: "demo",
            name: "Synthetic current",
            settingsConfig: {},
          },
        }}
        currentProviderId="demo"
        routeEnabled={routeEnabled}
        onOpenSettings={onOpenSettings}
      />
    </QueryClientProvider>,
  );
  return { onOpenSettings };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state.proxy, {
    isLoading: false,
    isTakeoverLoading: false,
    error: null,
    isRunning: false,
    isPending: false,
    status: { active_targets: [] },
    takeoverStatus: { codex: false },
  });
});

describe("provider connection modes", () => {
  it("routes only the current app through the existing native mutation", () => {
    mount();
    expect(
      screen.getByRole("button", { name: "connectionMode.direct" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "connectionMode.route" }),
    );
    expect(state.proxy.setTakeoverForApp).toHaveBeenCalledWith({
      appType: "codex",
      enabled: true,
    });
    // State remains direct until the query confirms the native result.
    expect(
      screen.getByRole("button", { name: "connectionMode.direct" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("restores only the current app when selecting direct mode", () => {
    state.proxy.takeoverStatus.codex = true;
    state.proxy.isRunning = true;
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "connectionMode.direct" }),
    );
    expect(state.proxy.setTakeoverForApp).toHaveBeenCalledWith({
      appType: "codex",
      enabled: false,
    });
  });
  it("opens routing settings when the advanced feature is disabled", () => {
    const { onOpenSettings } = mount(false);
    fireEvent.click(
      screen.getByRole("button", { name: "connectionMode.route" }),
    );
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(state.proxy.setTakeoverForApp).not.toHaveBeenCalled();
  });
  it("never treats an unreadable state as a confirmed direct connection", () => {
    state.proxy.error = new Error("synthetic");
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "connectionMode.failed",
    );
    for (const mode of ["direct", "route"]) {
      const button = screen.getByRole("button", {
        name: `connectionMode.${mode}`,
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });
  it("waits for takeover state and blocks changes during a mutation", () => {
    state.proxy.isTakeoverLoading = true;
    state.proxy.isPending = true;
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "connectionMode.loading",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "connectionMode.route" }),
    );
    expect(state.proxy.setTakeoverForApp).not.toHaveBeenCalled();
  });
  it("shows a stopped route and restarts without changing takeover ownership", () => {
    state.proxy.takeoverStatus.codex = true;
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "connectionMode.stopped",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "connectionMode.route" }),
    );
    expect(state.proxy.startProxyServer).toHaveBeenCalledOnce();
    expect(state.proxy.setTakeoverForApp).not.toHaveBeenCalled();
  });
  it("uses the active target rather than claiming the configured provider is routing", () => {
    state.proxy.takeoverStatus.codex = true;
    state.proxy.isRunning = true;
    state.proxy.status.active_targets = [];
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "connectionMode.routeReady",
    );
  });
  it("opens aggregation configuration without changing connection state", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "aggregation.title" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "aggregation.description",
    );
    expect(state.proxy.setTakeoverForApp).not.toHaveBeenCalled();
    expect(state.proxy.startProxyServer).not.toHaveBeenCalled();
  });
  it("displays the actual routed target when failover differs from the configured provider", () => {
    state.proxy.takeoverStatus.codex = true;
    state.proxy.isRunning = true;
    state.proxy.status.active_targets = [
      { app_type: "codex", provider_name: "Synthetic failover target" },
    ];
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Synthetic failover target",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Synthetic current",
    );
  });
});
