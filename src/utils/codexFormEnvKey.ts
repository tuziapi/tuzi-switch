import { isCodexEnvKeyDuplicate } from "./providerConfigUtils";

export const CODEX_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Existing references are immutable; allocation is only for new/missing keys. */
export function resolveCodexFormEnvKey({
  existingEnvKey,
  candidate,
  official,
  providers,
  shellEnvKeys,
}: {
  existingEnvKey?: string;
  candidate: string;
  official: boolean;
  providers?: Record<string, { settingsConfig?: unknown }>;
  shellEnvKeys?: Record<string, string>;
}): string {
  if (existingEnvKey?.trim()) return existingEnvKey.trim();
  if (official && !candidate.trim()) return "";
  const base = CODEX_ENV_KEY_PATTERN.test(candidate.trim())
    ? candidate.trim()
    : "CUSTOM_CODEX_API_KEY";
  const used = (key: string) =>
    isCodexEnvKeyDuplicate(key, { providers, shellEnvKeys });
  if (!used(base)) return base;
  const numbered = base.match(/^(TUZI|CODING)\d{2}_CODEX_API_KEY$/);
  if (numbered) {
    for (let i = 1; i <= 99; i++) {
      const next = `${numbered[1]}${String(i).padStart(2, "0")}_CODEX_API_KEY`;
      if (!used(next)) return next;
    }
  }
  let suffix = 1;
  while (used(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}
