// Real account components with synthetic state. No real account connection or writes.
import { useState } from "react";
import { AccountPage } from "@/components/account/AccountPage";
import { ConfigureTool } from "@/components/account/ConfigureTool";
import { disconnectedAccount, type AccountState } from "@/lib/api/account";
import type { DesktopKey, DesktopPricing } from "@/lib/api/desktop";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TuziNativeToolDialog } from "@/components/providers/TuziNativeToolDialog";
import { isNativeTool, type NativeTool } from "@/lib/api/nativeTools";
import type { TuziProviderDraft } from "@/lib/tuziToolCompatibility";
export function AccountWorkspacePreview({
  onNativeSaved,
}: {
  onNativeSaved?: (tool: NativeTool, id: string) => void;
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [draft, setDraft] = useState<TuziProviderDraft<NativeTool> | null>(
    null,
  );
  const [connected, setConnected] = useState(
    new URLSearchParams(location.search).get("account") !== "disconnected",
  );
  const [configure, setConfigure] = useState<{
    key: DesktopKey;
    model?: DesktopPricing;
  } | null>(null);
  const state: AccountState = {
    ...disconnectedAccount,
    status: connected ? "connected" : "disconnected",
    generation: 1,
    identity: connected
      ? {
          userId: "synthetic-user",
          username: "preview_synthetic",
          displayName: "本地合成账户",
          connectionId: "synthetic-connection",
        }
      : null,
  };
  const blocked = async () => {
    throw new Error("Synthetic preview rejects external actions");
  };
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-[11px] text-muted-foreground">
          <span>账户样式预览 · 合成数据 · 真实操作已隔离</span>
          <Button
            className="rounded-full text-xs"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfigure(null);
              setConnected(!connected);
            }}
          >
            {connected ? "查看未连接页面" : "查看已连接页面"}
          </Button>
        </div>
        <AccountPage
          account={{
            state,
            isLoading: false,
            connect: blocked,
            openTokenPage: blocked,
            logout: async () => {
              setConnected(false);
            },
            retry: async () => state,
          }}
          onConfigureKey={(key, model) => setConfigure({ key, model })}
        />
        {configure && (
          <ConfigureTool
            state={state}
            keyDto={configure.key}
            model={configure.model}
            onClose={() => setConfigure(null)}
            onExisting={(tool, id) => {
              if (isNativeTool(tool)) {
                setConfigure(null);
                onNativeSaved?.(tool, id);
              }
            }}
            onReady={(value) => {
              setConfigure(null);
              if (isNativeTool(value.appId))
                setDraft(value as TuziProviderDraft<NativeTool>);
            }}
          />
        )}
        {draft && (
          <TuziNativeToolDialog
            draft={draft}
            onClose={() => setDraft(null)}
            onSaved={(id) => {
              setDraft(null);
              onNativeSaved?.(draft.appId, id);
            }}
          />
        )}
      </div>
    </QueryClientProvider>
  );
}
