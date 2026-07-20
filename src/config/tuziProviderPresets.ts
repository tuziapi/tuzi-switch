/**
 * Tuzi product presets kept outside the upstream CC preset lists.
 *
 * Centralizing the business routes here keeps future upstream preset refreshes
 * additive and avoids copying whole CC configuration files.
 */

export const TUZI_LINKS = {
  apiKey: "https://api.tu-zi.com",
  codexSubscription: "https://store.tu-zi.com/cat/11",
  gaccode: "https://store.tu-zi.com/cat/1",
} as const;

export const TUZI_CODEX_MODEL = "gpt-5.6-sol";
export const TUZI_AGENT_CODEX_MODEL = "gpt-5.5";
export const TUZI_CLAUDE_MODEL = "claude-sonnet-4-6";
export const TUZI_GEMINI_MODEL = "gemini-3.1-pro";
export const TUZI_IMAGE_GENERATION_HEADER = "http://coding.tu-zi.com" as const;

export const TUZI_CLAUDE_ROUTES = [
  {
    name: "兔子线路",
    apiKeyUrl: TUZI_LINKS.apiKey,
    baseUrl: "https://apius.tu-zi.com",
    model: "anthropic/claude-sonnet-4.6",
    haikuModel: "anthropic/claude-haiku-4.5",
    sonnetModel: "anthropic/claude-sonnet-4.6",
    opusModel: "anthropic/claude-opus-4.7",
    icon: "tuzi",
  },
  {
    name: "gaccode",
    apiKeyUrl: TUZI_LINKS.gaccode,
    baseUrl: "https://gaccode.com/claudecode",
    model: "anthropic/claude-sonnet-4.6",
    haikuModel: "anthropic/claude-haiku-4.5",
    sonnetModel: "anthropic/claude-sonnet-4.6",
    opusModel: "anthropic/claude-opus-4.7",
    icon: "gaccode",
  },
] as const;

export const TUZI_CODEX_ROUTES = [
  {
    name: "兔子线路",
    providerId: "tuzi",
    apiKeyUrl: TUZI_LINKS.apiKey,
    baseUrl: "https://api.tu-zi.com/v1",
    envKey: "TUZI_CODEX_API_KEY",
    endpointCandidates: [
      "https://api.tu-zi.com/v1",
      "https://coding.tu-zi.com",
      "https://coding.opentu.ai",
      "https://coding.sydney-ai.com",
      "https://test-coding.tu-zi.com",
      "https://sub2api-origin.sydney-ai.com",
    ],
    icon: "tuzi",
  },
  {
    name: "codex订阅",
    providerId: "codex",
    apiKeyUrl: TUZI_LINKS.codexSubscription,
    baseUrl: "https://api.tu-zi.com/coding",
    envKey: "CODING_CODEX_API_KEY",
    endpointCandidates: [
      "https://api.tu-zi.com/coding",
      "https://coding.tu-zi.com",
      "https://coding.opentu.ai",
      "https://coding.sydney-ai.com",
    ],
    icon: "codex-sub",
  },
  {
    name: "gaccode",
    providerId: "gac",
    apiKeyUrl: TUZI_LINKS.gaccode,
    baseUrl: "https://gaccode.com/codex/v1",
    envKey: "GAC_CODEX_API_KEY",
    endpointCandidates: ["https://gaccode.com/codex/v1"],
    icon: "gaccode",
  },
] as const;

export const TUZI_AGENT_ROUTES = [
  {
    name: "codex-tuzi",
    apiKeyUrl: TUZI_LINKS.apiKey,
    baseUrl: "https://api.tu-zi.com/v1",
    openclawApi: "openai-completions",
    hermesApiMode: "codex_responses",
    model: TUZI_AGENT_CODEX_MODEL,
    modelName: "GPT-5.5",
    contextWindow: 200_000,
    cost: { input: 5, output: 15 },
    icon: "tuzi",
  },
  {
    name: "codex-coding",
    apiKeyUrl: TUZI_LINKS.codexSubscription,
    baseUrl: "https://api.tu-zi.com/coding",
    openclawApi: "openai-completions",
    hermesApiMode: "codex_responses",
    model: TUZI_AGENT_CODEX_MODEL,
    modelName: "GPT-5.5",
    contextWindow: 200_000,
    cost: { input: 5, output: 15 },
    icon: "codex-sub",
  },
  {
    name: "codex-gaccode",
    apiKeyUrl: TUZI_LINKS.gaccode,
    baseUrl: "https://gaccode.com/code/v1",
    openclawApi: "openai-completions",
    hermesApiMode: "codex_responses",
    model: TUZI_AGENT_CODEX_MODEL,
    modelName: "GPT-5.5",
    contextWindow: 200_000,
    cost: { input: 5, output: 15 },
    icon: "gaccode",
  },
  {
    name: "claude-tuzi",
    apiKeyUrl: TUZI_LINKS.apiKey,
    baseUrl: "https://api.tu-zi.com/v1",
    openclawApi: "anthropic-messages",
    hermesApiMode: "anthropic_messages",
    model: TUZI_CLAUDE_MODEL,
    modelName: "Claude Sonnet 4.6",
    contextWindow: 1_000_000,
    cost: { input: 3, output: 15 },
    icon: "tuzi",
  },
  {
    name: "claude-gaccode",
    apiKeyUrl: TUZI_LINKS.gaccode,
    baseUrl: "https://gaccode.com/claudecode",
    openclawApi: "anthropic-messages",
    hermesApiMode: "anthropic_messages",
    model: TUZI_CLAUDE_MODEL,
    modelName: "Claude Sonnet 4.6",
    contextWindow: 1_000_000,
    cost: { input: 3, output: 15 },
    icon: "gaccode",
  },
] as const;

export type TuziAgentRoute = (typeof TUZI_AGENT_ROUTES)[number];
export type TuziCodexAgentRoute = Extract<
  TuziAgentRoute,
  { openclawApi: "openai-completions" }
>;
export type TuziClaudeAgentRoute = Extract<
  TuziAgentRoute,
  { openclawApi: "anthropic-messages" }
>;

export const TUZI_CODEX_AGENT_ROUTES = TUZI_AGENT_ROUTES.filter(
  (route): route is TuziCodexAgentRoute =>
    route.openclawApi === "openai-completions",
);

export const TUZI_CLAUDE_AGENT_ROUTES = TUZI_AGENT_ROUTES.filter(
  (route): route is TuziClaudeAgentRoute =>
    route.openclawApi === "anthropic-messages",
);
