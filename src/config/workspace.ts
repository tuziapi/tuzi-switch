import type { AppId } from "@/lib/api";
import type { NativeTool } from "@/lib/api/nativeTools";
import { MCP_APP_IDS, SKILLS_APP_IDS } from "@/config/appConfig";
export type WorkspaceTool = AppId | NativeTool;
export const WORKSPACE_TOOLS: WorkspaceTool[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
  "grokbuild",
  "pi",
  "mcode",
];
export const WORKSPACE_TOOL_NAMES: Record<WorkspaceTool, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  grokbuild: "Grok Build",
  pi: "Pi",
  mcode: "MiniMax Code",
};
export const WORKSPACE_SUPPORT: Record<
  "mcp" | "skills" | "prompts" | "sessions" | "agents",
  WorkspaceTool[]
> = {
  mcp: MCP_APP_IDS,
  agents: ["claude", "opencode"],
  skills: SKILLS_APP_IDS,
  prompts: ["claude", "codex", "gemini", "opencode", "openclaw", "hermes"],
  sessions: ["claude", "codex", "gemini", "opencode", "openclaw", "hermes"],
};
export const GLOBAL_WORKSPACE_VIEWS = [
  "mcp",
  "skills",
  "skillsDiscovery",
  "prompts",
  "sessions",
  "auth",
  "usage",
  "agents",
  "universal",
] as const;
