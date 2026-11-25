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
export interface OpenTuConnectorStatus {
  configured: boolean;
  lastToolCallAt: number | null;
  configPath: string;
  scope: "local" | "isolated";
}
export const opentuMcpApi = {
  connectorStatus: () =>
    invoke<OpenTuConnectorStatus>("opentu_connector_status", {
      connectLocal: true,
    }),
  installConnector: (expectedConfigPath: string) =>
    invoke<OpenTuConnectorStatus>("opentu_connector_install", {
      connectLocal: true,
      expectedConfigPath,
    }),
  removeConnector: (expectedConfigPath: string) =>
    invoke<OpenTuConnectorStatus>("opentu_connector_remove", {
      connectLocal: true,
      expectedConfigPath,
    }),
  pairing: () => invoke<OpenTuPairing>("opentu_mcp_pairing"),
  copy: (field: "endpoint" | "token" | "authorization") =>
    invoke<void>("opentu_mcp_copy", { field }),
  check: () => invoke<OpenTuConnectionCheck>("opentu_mcp_check"),
};
