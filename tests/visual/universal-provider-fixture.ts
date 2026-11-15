import type { UniversalProvider, UniversalProvidersMap } from "@/types";

// Explicit opt-in browser fixture. Never invokes native commands or remote APIs.
const storageKey = "synthetic-universal-provider-qa";
const fixture = {
  providers: JSON.parse(
    sessionStorage.getItem(storageKey) || "{}",
  ) as UniversalProvidersMap,
  failSave: false,
  failSync: false,
  calls: [] as { command: string; id?: string }[],
};
(window as any).__universalFixture = fixture;
export async function universalProviderPreviewIPC(
  command: string,
  args: Record<string, unknown>,
) {
  const provider = args.provider as UniversalProvider;
  fixture.calls.push({ command, id: provider?.id || (args.id as string) });
  if (command === "get_universal_providers")
    return structuredClone(fixture.providers);
  if (command === "upsert_universal_provider") {
    if (fixture.failSave) throw new Error("Synthetic save failure");
    fixture.providers[provider.id] = structuredClone(provider);
  } else if (command === "sync_universal_provider") {
    if (fixture.failSync) throw new Error("Synthetic sync failure");
    return true;
  } else if (command === "delete_universal_provider") {
    delete fixture.providers[args.id as string];
  } else throw new Error("Unsupported synthetic universal command");
  sessionStorage.setItem(storageKey, JSON.stringify(fixture.providers));
  return true;
}
