// In-memory synthetic IPC only. Never opens a file or contacts a service.
import {
  nativeToolTemplate,
  type NativeTool,
  type NativeToolSnapshot,
  type NativeToolChange,
} from "@/lib/api/nativeTools";
type Origin = {
  site: string;
  userId: string;
  tokenId: string;
  app: NativeTool;
  providerId: string;
  config: string;
};
const snapshots = Object.fromEntries(
  (["grokbuild", "pi", "mcode"] as const).map((tool) => [
    tool,
    {
      revision: "synthetic-1",
      providers: {},
      current: null,
      path: `/synthetic/${tool}/config`,
      canRestore: false,
    },
  ]),
) as Record<NativeTool, NativeToolSnapshot>;
let sources: Origin[] = [];
const backups: Partial<
  Record<NativeTool, { snapshot: NativeToolSnapshot; sources: Origin[] }>
> = {};
export function nativePreviewSources(app?: string | null) {
  return sources
    .filter((s) => !app || s.app === app)
    .map(({ config: _, ...s }) => s);
}
export function nativePreviewSourceResult() {
  return { sources: nativePreviewSources(), unavailable: [] as string[] };
}
export async function nativePreviewIPC(command: string, args: unknown) {
  const payload = args as {
    tool: NativeTool;
    revision?: string;
    change?: NativeToolChange;
    selection?: {
      id: string;
      name: string;
      model: string;
      key: string;
      protocol: string;
      contextWindow: number | null;
    };
    source?: {
      site: string;
      userId: string;
      tokenId: string;
      generation: number;
    };
  };
  const { tool } = payload;
  const snapshot = snapshots[tool];
  if (!snapshot) throw new Error("Unknown synthetic tool");
  if (command === "native_tool_read") return structuredClone(snapshot);
  if (command === "native_tool_restore") {
    const backup = backups[tool];
    if (!backup || payload.revision !== snapshot.revision)
      throw new Error("Synthetic restore conflict");
    snapshots[tool] = {
      ...structuredClone(backup.snapshot),
      canRestore: false,
    };
    sources = sources.filter((s) => s.app !== tool).concat(backup.sources);
    return snapshots[tool];
  }
  let change = payload.change;
  if (command === "tuzi_native_tool_save") {
    const sel = payload.selection!,
      src = payload.source!;
    if (
      src.userId !== "synthetic-user" ||
      src.generation !== 1 ||
      !src.tokenId.startsWith("synthetic-key-") ||
      sel.key !== "sk-SYNTHETIC_PREVIEW_ONLY" ||
      src.site !== "https://api.tu-zi.com"
    )
      throw new Error("Synthetic source rejected");
    if (
      sources.some((s) => s.app === tool && s.tokenId === src.tokenId) ||
      snapshot.providers[sel.id]
    )
      throw new Error("Synthetic duplicate");
    const api = {
      chat: "openai-completions",
      responses: "openai-responses",
      anthropic: "anthropic-messages",
    }[sel.protocol];
    if (!api) throw new Error("Synthetic unsupported protocol");
    const endpoint =
      tool !== "grokbuild" && sel.protocol === "anthropic"
        ? "https://api.tu-zi.com"
        : "https://api.tu-zi.com/v1";
    let config: Record<string, unknown>;
    if (tool === "grokbuild")
      config = {
        name: sel.name,
        model: sel.model,
        api_key: sel.key,
        base_url: endpoint,
        api_backend: {
          chat: "chat_completions",
          responses: "responses",
          anthropic: "messages",
        }[sel.protocol],
        ...(sel.contextWindow ? { context_window: sel.contextWindow } : {}),
      };
    else if (tool === "pi")
      config = {
        baseUrl: endpoint,
        apiKey: sel.key,
        api,
        models: [{ id: sel.model, name: sel.name }],
      };
    else
      config = {
        ...nativeToolTemplate(tool),
        name: sel.name,
        api,
        options: { baseURL: endpoint, apiKey: sel.key },
        models: { [sel.model]: {} },
      };
    change = { revision: payload.revision!, id: sel.id, config };
  } else if (command !== "native_tool_write")
    throw new Error("Unknown synthetic native IPC");
  if (!change || change.revision !== snapshot.revision)
    throw new Error("Synthetic native conflict");
  backups[tool] = {
    snapshot: structuredClone(snapshot),
    sources: sources.filter((s) => s.app === tool),
  };
  const next = structuredClone(snapshot);
  if (change.config === null) delete next.providers[change.id];
  else next.providers[change.id] = change.config;
  if (change.select) next.current = change.id;
  next.revision = `synthetic-${crypto.randomUUID()}`;
  next.canRestore = true;
  snapshots[tool] = next;
  sources = sources.filter(
    (s) =>
      s.app !== tool ||
      JSON.stringify(next.providers[s.providerId]) === s.config,
  );
  if (command === "tuzi_native_tool_save")
    sources.push({
      ...payload.source!,
      app: tool,
      providerId: change.id,
      config: JSON.stringify(change.config),
    });
  return next;
}
