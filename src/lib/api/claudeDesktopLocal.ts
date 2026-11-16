import { invoke } from "@tauri-apps/api/core";

export interface ClaudeLocalStatus {
  enabled: boolean;
  recoveryRequired?: boolean;
  boundProvider?: string | null;
  profileDir?: string | null;
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
  | "trust"
  | "untrust"
  | "launch"
  | "stop";
export const claudeDesktopLocal = {
  status: () => invoke<ClaudeLocalStatus>("get_claude_local_status"),
  action: (action: ClaudeLocalAction, providerId?: string) =>
    invoke<ClaudeLocalStatus>("claude_local_action", { action, providerId }),
};
