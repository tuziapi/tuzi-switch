import { invoke } from "@tauri-apps/api/core";

export interface OfficialMcpStatus {
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
  status: () => invoke<OfficialMcpStatus>("tuzi_mcp_status"),
  start: (action: "connect" | "check") =>
    invoke<void>("tuzi_mcp_start", { action }),
  cancel: () => invoke<void>("tuzi_mcp_cancel"),
  manage: () => invoke<void>("tuzi_mcp_manage"),
};
