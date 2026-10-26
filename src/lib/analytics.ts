/** Only fixed categories cross this boundary. Never spread business data into an event. */
const actions = {
  navigation: ["view"],
  account: ["get_token", "connect", "check", "disconnect"],
  keys: ["create", "edit", "enable", "disable", "delete", "reveal", "copy"],
  configure_tool: ["open", "select_tool", "save"],
  providers: ["add", "edit", "duplicate", "delete", "switch"],
  skills: ["install", "import", "uninstall", "restore"],
  mcp: ["add", "edit", "import", "delete", "enable", "disable"],
  prompts: ["add", "edit", "delete", "enable", "disable", "import"],
  proxy: ["start", "stop", "failover_enable", "failover_disable"],
  config: [
    "import",
    "export",
    "backup",
    "restore",
    "sync_upload",
    "sync_download",
  ],
} as const;
export type AnalyticsModule = keyof typeof actions;
export type AnalyticsAction = (typeof actions)[AnalyticsModule][number];
export type AnalyticsContext = { tool?: string; page?: string };
export type Outcome = "success" | "failure" | "unknown" | "partial";
type ErrorCategory =
  | "network"
  | "permission"
  | "validation"
  | "local_write"
  | "other";
const tools = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];
const pages = [
  "account",
  "providers",
  "settings",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "agents",
  "universal",
  "sessions",
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawAgents",
  "hermesMemory",
  "general",
  "proxy",
  "auth",
  "advanced",
  "usage",
  "about",
];

/** Classify structured codes only; never serialize exception messages or response bodies. */
export function errorCategory(error: unknown): ErrorCategory {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (
    [
      "network",
      "network_error",
      "offline",
      "timeout",
      "transport_error",
    ].includes(String(code))
  )
    return "network";
  if (
    [
      "unauthorized",
      "forbidden",
      "permission_denied",
      "invalid_token",
      "token_invalid",
    ].includes(String(code))
  )
    return "permission";
  if (
    [
      "validation",
      "validation_error",
      "invalid_input",
      "invalid_request",
    ].includes(String(code))
  )
    return "validation";
  if (["storage_error", "write_failed", "io_error"].includes(String(code)))
    return "local_write";
  return "other";
}
export function errorOutcome(error: unknown): Outcome {
  return error &&
    typeof error === "object" &&
    "outcomeUnknown" in error &&
    error.outcomeUnknown === true
    ? "unknown"
    : "failure";
}

type Tracker = {
  track: (name: string, data: Record<string, string>) => unknown;
};
function emit(
  module: AnalyticsModule,
  action: AnalyticsAction,
  stage: "interaction" | "submit" | "result",
  context: AnalyticsContext,
  outcome?: Outcome,
  error?: unknown,
) {
  try {
    if (
      !(module in actions) ||
      !(actions[module] as readonly string[]).includes(action)
    )
      return;
    const tracker = (window as Window & { umami?: Tracker }).umami;
    if (!tracker) return; // Best effort: no persistence, retry loop or blocking dependency.
    const data: Record<string, string> = {
      version: __APP_VERSION__,
      environment:
        import.meta.env.DEV || import.meta.env.TAURI_ENV_DEBUG === "true"
          ? "development"
          : "production",
      module,
      action,
      stage,
    };
    if (context.tool && tools.includes(context.tool)) data.tool = context.tool;
    if (context.page && pages.includes(context.page)) data.page = context.page;
    if (
      outcome &&
      ["success", "failure", "unknown", "partial"].includes(outcome)
    )
      data.outcome = outcome;
    if (outcome === "failure" || outcome === "unknown" || outcome === "partial")
      data.error_category = errorCategory(error);
    // Neither synchronous errors nor rejected telemetry promises affect the operation.
    void Promise.resolve(tracker.track(`${module}_${action}`, data)).catch(
      () => {},
    );
  } catch {
    /* Analytics must never interrupt the UI. */
  }
}

export function trackInteraction(
  module: AnalyticsModule,
  action: AnalyticsAction,
  context: AnalyticsContext = {},
) {
  emit(module, action, "interaction", context);
}

/** Exactly one terminal result per submitted operation, even across late callbacks. */
export function beginOperation(
  module: AnalyticsModule,
  action: AnalyticsAction,
  context: AnalyticsContext = {},
) {
  emit(module, action, "submit", context);
  let finished = false;
  return (outcome: Outcome, error?: unknown) => {
    if (finished) return;
    finished = true;
    emit(module, action, "result", context, outcome, error);
  };
}

/** Wrap the business call, not cache refreshes/toasts, to preserve the actual result. */
export async function trackOperation<T>(
  module: AnalyticsModule,
  action: AnalyticsAction,
  context: AnalyticsContext,
  run: () => Promise<T>,
  outcome?: (result: T) => Outcome,
): Promise<T> {
  const finish = beginOperation(module, action, context);
  try {
    const result = await run();
    finish(
      outcome ? outcome(result) : result === false ? "failure" : "success",
    );
    return result;
  } catch (error) {
    finish(errorOutcome(error), error);
    throw error;
  }
}
