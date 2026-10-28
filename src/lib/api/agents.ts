import { invoke } from "@tauri-apps/api/core";

export type AgentTool = "claude" | "opencode";
export interface AgentFile {
  id: string;
  content: string;
  validationError: string | null;
}
export interface AgentSnapshot {
  revision: string;
  path: string;
  files: AgentFile[];
  canRestore: boolean;
}
export interface AgentChange {
  revision: string;
  id: string;
  content: string | null;
}
export const agentsApi = {
  read: (tool: AgentTool) => invoke<AgentSnapshot>("agents_read", { tool }),
  write: (tool: AgentTool, change: AgentChange) =>
    invoke<AgentSnapshot>("agents_write", { tool, change }),
  restore: (tool: AgentTool, revision: string) =>
    invoke<AgentSnapshot>("agents_restore", { tool, revision }),
};
export function agentTemplate(tool: AgentTool) {
  return tool === "claude"
    ? "---\nname: code-reviewer\ndescription: Review code for correctness and maintainability\ntools: Read, Grep, Glob\n---\nReview the requested code. Explain findings and suggest changes without modifying files.\n"
    : "---\ndescription: Review code for correctness and maintainability\nmode: subagent\npermission:\n  edit: deny\n  bash: deny\n---\nReview the requested code. Explain findings and suggest changes without modifying files.\n";
}
