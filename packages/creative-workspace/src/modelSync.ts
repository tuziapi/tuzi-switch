import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { CreativeAccountBridge } from "./bridge-types";
import {
  ASSISTANT_ACCOUNT_CHANGED,
  getAssistantAccount,
  isAccountReference,
  setAssistantAccount,
} from "../upstream/packages/drawnix/src/services/assistant-account";
import {
  providerProfilesSettings,
  settingsManager,
  type ProviderProfile,
} from "../upstream/packages/drawnix/src/utils/settings-manager";
import { runtimeModelDiscovery } from "../upstream/packages/drawnix/src/utils/runtime-model-discovery";
import { discoverProviderModels } from "../upstream/packages/drawnix/src/services/provider-model-catalog";
import { DRAWNIX_SETTINGS_KEY } from "../upstream/packages/drawnix/src/constants/storage";

declare const __CREATIVE_MODEL_REFRESH_REVISION__: string;
export const MODEL_REFRESH_STORAGE_KEY = "tuzi-creative-model-refresh-v1";
export const MODEL_REFRESH_REVISION =
  typeof __CREATIVE_MODEL_REFRESH_REVISION__ === "string"
    ? __CREATIVE_MODEL_REFRESH_REVISION__
    : "test-model-refresh-v1";
const RETRY_DELAYS = [5_000, 30_000, 120_000];
interface RefreshRecord {
  revision: string;
  source: string;
  discoveredAt: number;
}

function sourceIdentity(profile: ProviderProfile): string {
  // Only this digest is persisted; credentials and native references never enter the marker.
  return bytesToHex(
    sha256(
      JSON.stringify([
        profile.id,
        profile.baseUrl,
        profile.apiKey,
        profile.authType,
        profile.extraHeaders,
        profile.pricingGroup,
        profile.pricingUrl,
        profile.capabilities,
        profile.imageApiCompatibility,
        isAccountReference(profile.apiKey)
          ? getAssistantAccount()?.state.identity?.userId
          : null,
      ]),
    ),
  );
}

function readRecords(): Record<string, RefreshRecord> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(MODEL_REFRESH_STORAGE_KEY) || "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, item]) =>
          item &&
          typeof item.revision === "string" &&
          typeof item.source === "string" &&
          /^[a-f0-9]{64}$/.test(item.source) &&
          Number.isFinite(item.discoveredAt),
      ),
    );
  } catch {
    return {};
  }
}

export function startModelUpgradeSync(initialBridge: CreativeAccountBridge) {
  let stopped = false;
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bridge = initialBridge;
  let active:
    | { id: string; key: string; controller: AbortController }
    | undefined;
  const failures = new Map<string, { attempts: number; retryAt: number }>();

  function sourceKey(profile: ProviderProfile) {
    const generation = isAccountReference(profile.apiKey)
      ? getAssistantAccount()?.state.generation
      : "";
    return `${sourceIdentity(profile)}:${generation}`;
  }
  function eligible(profile: ProviderProfile) {
    return (
      profile.enabled &&
      profile.apiKey.trim() &&
      profile.capabilities.supportsModelsEndpoint !== false &&
      (!isAccountReference(profile.apiKey) ||
        getAssistantAccount()?.state.status === "connected")
    );
  }
  function current(id: string, key: string) {
    const profile = providerProfilesSettings
      .get()
      .find((item) => item.id === id);
    return (
      !stopped && !!profile && !!eligible(profile) && sourceKey(profile) === key
    );
  }
  function schedule(delay = 100) {
    if (stopped || !initialized) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void scan();
    }, delay);
  }
  function changed() {
    if (active && !current(active.id, active.key)) active.controller.abort();
    schedule();
  }
  function online() {
    failures.clear();
    schedule();
  }
  function offline() {
    active?.controller.abort();
    clearTimeout(timer);
  }

  async function scan() {
    if (stopped || !initialized || navigator.onLine === false || active) return;
    let nextDelay = Infinity;
    const records = readRecords();
    for (const profile of providerProfilesSettings.get()) {
      if (!eligible(profile)) continue;
      const source = sourceIdentity(profile);
      const key = sourceKey(profile);
      const state = runtimeModelDiscovery.getState(profile.id);
      const record = records[profile.id];
      if (
        record?.revision === MODEL_REFRESH_REVISION &&
        record.source === source &&
        record.discoveredAt === state.discoveredAt &&
        state.discoveredModels.length
      )
        continue;
      const failure = failures.get(key);
      if (failure && failure.retryAt > Date.now()) {
        nextDelay = Math.min(nextDelay, failure.retryAt - Date.now());
        continue;
      }
      if (runtimeModelDiscovery.isDiscovering(profile.id)) {
        nextDelay = Math.min(nextDelay, 1_000);
        continue;
      }
      const controller = new AbortController();
      active = { id: profile.id, key, controller };
      const isCurrent = () =>
        current(profile.id, key) && !controller.signal.aborted;
      try {
        await discoverProviderModels(profile, [], {
          selectNew: true,
          signal: controller.signal,
          isCurrent,
          forceMarketplaceRefresh: true,
        });
        if (!isCurrent()) continue;
        // Discovery updates the shared catalog. Flush a current serialized snapshot
        // before writing a separate, device-local completion marker.
        await settingsManager.flushStorage();
        if (!isCurrent()) continue;
        const latest = runtimeModelDiscovery.getState(profile.id);
        const saved = JSON.parse(
          localStorage.getItem(DRAWNIX_SETTINGS_KEY) || "{}",
        );
        const savedCatalog = saved.providerCatalogs?.find(
          (item: { profileId: string }) => item.profileId === profile.id,
        );
        if (
          !latest.discoveredAt ||
          savedCatalog?.discoveredAt !== latest.discoveredAt
        ) {
          throw new Error("Catalog not persisted");
        }
        const updated = readRecords();
        // Drop records for deleted profiles; do not retain a history of sources.
        const ids = new Set(
          providerProfilesSettings.get().map((item) => item.id),
        );
        for (const id of Object.keys(updated))
          if (!ids.has(id)) delete updated[id];
        updated[profile.id] = {
          revision: MODEL_REFRESH_REVISION,
          source,
          discoveredAt: latest.discoveredAt,
        };
        localStorage.setItem(
          MODEL_REFRESH_STORAGE_KEY,
          JSON.stringify(updated),
        );
        failures.delete(key);
      } catch (error) {
        if (
          isCurrent() &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          const attempts = (failures.get(key)?.attempts || 0) + 1;
          failures.set(key, {
            attempts,
            retryAt:
              attempts <= RETRY_DELAYS.length
                ? Date.now() + RETRY_DELAYS[attempts - 1]
                : Infinity,
          });
          runtimeModelDiscovery.setError(
            profile.id,
            "自动同步模型失败，已有配置已保留；联网后将重试，也可在创作配置中重新获取。",
          );
        }
      } finally {
        active = undefined;
        schedule();
      }
      // One provider at a time; yielding keeps startup/network work bounded.
      return;
    }
    if (Number.isFinite(nextDelay)) schedule(Math.max(100, nextDelay));
  }

  setAssistantAccount(bridge);
  providerProfilesSettings.addListener(changed);
  window.addEventListener(ASSISTANT_ACCOUNT_CHANGED, changed);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  void settingsManager.waitForInitialization().then(() => {
    initialized = true;
    schedule();
  });
  return {
    updateAccountBridge(next: CreativeAccountBridge) {
      bridge = next;
      setAssistantAccount(next);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      active?.controller.abort();
      providerProfilesSettings.removeListener(changed);
      window.removeEventListener(ASSISTANT_ACCOUNT_CHANGED, changed);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      if (getAssistantAccount() === bridge) setAssistantAccount(undefined);
    },
  };
}
