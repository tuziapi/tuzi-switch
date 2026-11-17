import { invoke } from "@tauri-apps/api/core";

export interface OpenTuPairing {
  endpoint: string;
  protocolVersion: string;
  canvasReady: boolean;
}
export interface OpenTuConnectionCheck {
  protocolVersion: string;
  toolCount: number;
  canvasReady: boolean;
}
export const opentuMcpApi = {
  pairing: () => invoke<OpenTuPairing>("opentu_mcp_pairing"),
  copy: (field: "endpoint" | "token" | "authorization") =>
    invoke<void>("opentu_mcp_copy", { field }),
  check: () => invoke<OpenTuConnectionCheck>("opentu_mcp_check"),
};
