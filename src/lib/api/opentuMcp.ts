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
}
export const opentuMcpApi = {
  connectorStatus: () =>
    invoke<OpenTuConnectorStatus>("opentu_connector_status"),
  installConnector: () =>
    invoke<OpenTuConnectorStatus>("opentu_connector_install"),
  removeConnector: () =>
    invoke<OpenTuConnectorStatus>("opentu_connector_remove"),
  pairing: () => invoke<OpenTuPairing>("opentu_mcp_pairing"),
  copy: (field: "endpoint" | "token" | "authorization") =>
    invoke<void>("opentu_mcp_copy", { field }),
  check: () => invoke<OpenTuConnectionCheck>("opentu_mcp_check"),
};
