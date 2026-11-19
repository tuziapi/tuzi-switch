import { invoke } from "@tauri-apps/api/core";

export interface ClaudeLocalStatus {
  enabled: boolean;
  desktopRunning?: boolean | null;
  recoveryRequired?: boolean;
  boundProvider?: string | null;
  profileDir?: string | null;
  options?: { voiceInput: boolean; computerUse: boolean; cowork: boolean };
  capabilities?: {
    platform: string;
    voiceInput: boolean;
    computerUse: boolean;
    cowork: boolean;
  };
  voiceModelReady?: boolean;
  voiceDownload?: {
    phase?: string;
    completedBytes?: number;
    totalBytes?: number;
  };
  core?: {
    supported: boolean;
    version: string;
    claudeRunning: boolean;
    running: boolean;
    connected: boolean;
    caReady: boolean;
    caTrusted: boolean;
    nodeAvailable: boolean;
    warning: string | null;
  } | null;
}
export type ClaudeLocalAction =
  | "prepare"
  | "prepare_connection"
  | "trust"
  | "untrust"
  | "launch"
  | "stop"
  | "prepare_voice"
  | "enable_voice"
  | "disable_voice"
  | "enable_computer"
  | "disable_computer"
  | "enable_cowork"
  | "disable_cowork";
export const claudeDesktopLocal = {
  officialInstallation: () =>
    invoke<boolean | null>("detect_official_claude_installation"),
  status: () => invoke<ClaudeLocalStatus>("get_claude_local_status"),
  action: (action: ClaudeLocalAction, providerId?: string) =>
    invoke<ClaudeLocalStatus>("claude_local_action", { action, providerId }),
};
