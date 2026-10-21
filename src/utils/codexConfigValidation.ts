import { parse } from "smol-toml";

/** Validate before any credential/file writes. Do not repair the user's draft. */
export function validateCodexConfigDocument(
  text: string,
  requireProvider: boolean,
): string | null {
  let doc: Record<string, unknown>;
  try {
    doc = parse(text);
  } catch {
    return "TOML 格式不完整或有误，请修正后保存。";
  }
  const rawProviders = doc.model_providers;
  const providers = rawProviders as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (
    providers !== undefined &&
    (!providers || typeof providers !== "object" || Array.isArray(providers))
  )
    return "model_providers 必须是配置表。";
  for (const [id, provider] of Object.entries(providers ?? {})) {
    if (
      !provider ||
      typeof provider !== "object" ||
      Array.isArray(provider) ||
      typeof provider.name !== "string" ||
      !provider.name.trim()
    )
      return `供应商 ${id} 缺少 name；请补齐或移除确认无用的残缺配置段。`;
  }
  if (!requireProvider && doc.model_provider === undefined) return null;
  const id = doc.model_provider;
  if (typeof id !== "string" || !id.trim()) return "请填写 model_provider。";
  if (
    !requireProvider &&
    ["openai", "ollama", "lmstudio"].includes(id) &&
    !(providers && id in providers)
  )
    return null;
  const provider =
    providers && typeof providers === "object" && !Array.isArray(providers)
      ? providers[id]
      : undefined;
  if (!provider || typeof provider !== "object" || Array.isArray(provider))
    return "model_provider 没有对应的供应商配置段。";
  if (typeof doc.model !== "string" || !doc.model.trim())
    return "请填写模型名称 model。";
  try {
    if (typeof provider.base_url !== "string") throw new Error();
    const url = new URL(provider.base_url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
  } catch {
    return "供应商 base_url 必须是有效的 HTTP(S) 地址，不能使用 Markdown 链接。";
  }
  return null;
}
