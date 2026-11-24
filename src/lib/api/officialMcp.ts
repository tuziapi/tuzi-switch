import { invoke } from "@tauri-apps/api/core";

export interface OfficialMcpStatus {
  configPath: string | null;
  scope: "local" | "isolated" | "unknown";
  configured: boolean;
  busy: boolean;
  phase: string;
  error: string | null;
  accountId: string | null;
  accountName: string | null;
  assistantAccountName: string | null;
  accountMismatch: boolean;
  checkedAt: number | null;
}

export const officialMcpApi = {
  status: () =>
    invoke<OfficialMcpStatus>("tuzi_mcp_status", { connectLocal: true }),
  start: (action: "connect" | "check", expectedConfigPath: string) =>
    invoke<void>("tuzi_mcp_start", {
      action,
      connectLocal: true,
      expectedConfigPath,
    }),
  cancel: () => invoke<void>("tuzi_mcp_cancel"),
  manage: () => invoke<void>("tuzi_mcp_manage"),
};
