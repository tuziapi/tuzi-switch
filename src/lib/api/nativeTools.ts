import { invoke } from "@tauri-apps/api/core";
export type NativeTool = "grokbuild" | "pi" | "mcode";
export function isNativeTool(tool: string): tool is NativeTool {
  return tool === "grokbuild" || tool === "pi" || tool === "mcode";
}
export const nativeToolNames: Record<NativeTool, string> = {
  grokbuild: "Grok Build",
  pi: "Pi",
  mcode: "MiniMax Code",
};
export interface NativeToolSnapshot {
  revision: string;
  providers: Record<string, unknown>;
  current: string | null;
  path: string;
  canRestore: boolean;
}
export interface NativeToolChange {
  revision: string;
  id: string;
  config: unknown | null;
  select?: boolean;
}
export const nativeToolsApi = {
  read: (tool: NativeTool) =>
    invoke<NativeToolSnapshot>("native_tool_read", { tool }),
  write: (tool: NativeTool, change: NativeToolChange) =>
    invoke<NativeToolSnapshot>("native_tool_write", { tool, change }),
  restore: (tool: NativeTool, revision: string) =>
    invoke<NativeToolSnapshot>("native_tool_restore", { tool, revision }),
};
export function nativeToolTemplate(tool: NativeTool) {
  if (tool === "grokbuild")
    return {
      name: "",
      model: "",
      base_url: "",
      api_key: "",
      api_backend: "responses",
    };
  if (tool === "pi")
    return {
      baseUrl: "",
      apiKey: "",
      api: "openai-completions",
      models: [{ id: "" }],
    };
  return {
    name: "",
    kind: "custom",
    enabled: true,
    api: "anthropic-messages",
    options: { baseURL: "", apiKey: "" },
    models: { "model-id": {} },
  };
}
