import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreativeAccountBridge } from "../src/bridge-types";

const mocks = vi.hoisted(() => ({
  profiles: [] as any[],
  states: new Map<string, any>(),
  listeners: new Set<() => void>(),
  discover: vi.fn(),
  flush: vi.fn(),
  busy: false,
}));
vi.mock("../upstream/packages/drawnix/src/utils/settings-manager", () => ({
  providerProfilesSettings: {
    get: () => mocks.profiles,
    addListener: (fn: () => void) => mocks.listeners.add(fn),
    removeListener: (fn: () => void) => mocks.listeners.delete(fn),
  },
  settingsManager: {
    waitForInitialization: async () => {},
    flushStorage: () => mocks.flush(),
  },
}));
vi.mock(
  "../upstream/packages/drawnix/src/utils/runtime-model-discovery",
  () => ({
    runtimeModelDiscovery: {
      getState: (id: string) =>
        mocks.states.get(id) || { discoveredModels: [], discoveredAt: null },
      isDiscovering: () => mocks.busy,
      setError: vi.fn(),
    },
  }),
);
vi.mock(
  "../upstream/packages/drawnix/src/services/provider-model-catalog",
  () => ({
    discoverProviderModels: (...args: any[]) => mocks.discover(...args),
  }),
);
import {
  startModelUpgradeSync,
  MODEL_REFRESH_STORAGE_KEY,
} from "../src/modelSync";
import { DRAWNIX_SETTINGS_KEY } from "../upstream/packages/drawnix/src/constants/storage";

function profile(id = "synthetic", key = "SYNTHETIC-NOT-A-KEY") {
  return {
    id,
    name: id,
    baseUrl: "https://synthetic.invalid/v1",
    apiKey: key,
    enabled: true,
    capabilities: { supportsModelsEndpoint: true },
  };
}
function bridge(status = "connected", generation = 1) {
  return {
    state: { status, generation, identity: { userId: "synthetic-user" } },
  } as CreativeAccountBridge;
}
let controller: ReturnType<typeof startModelUpgradeSync> | undefined;
const tick = (ms = 200) => vi.advanceTimersByTimeAsync(ms);
const changed = () => mocks.listeners.forEach((fn) => fn());
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mocks.listeners.clear();
  mocks.states.clear();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  mocks.profiles = [profile()];
  mocks.busy = false;
  mocks.discover
    .mockReset()
    .mockImplementation(async (item, _fallback, options) => {
      expect(options.selectNew).toBe(true);
      if (options.isCurrent())
        mocks.states.set(item.id, {
          profileId: item.id,
          discoveredModels: [{ id: "gpt-image-2.6-flare" }],
          discoveredAt: Date.now(),
        });
    });
  mocks.flush.mockReset().mockImplementation(async () => {
    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({ providerCatalogs: [...mocks.states.values()] }),
    );
  });
});
afterEach(() => {
  controller?.stop();
  controller = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("automatic upgrade discovery", () => {
  it("fetches on upgrade and skips same revision after restart without storing credentials", async () => {
    controller = startModelUpgradeSync(bridge());
    await tick();
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    const saved = localStorage.getItem(MODEL_REFRESH_STORAGE_KEY)!;
    expect(saved).not.toContain("SYNTHETIC-NOT-A-KEY");
    expect(saved).not.toContain("synthetic.invalid");
    controller.stop();
    controller = startModelUpgradeSync(bridge());
    await tick(10_000);
    expect(mocks.discover).toHaveBeenCalledTimes(1);
  });
  it("refreshes an old revision including a same-version rebuilt adaptation", async () => {
    controller = startModelUpgradeSync(bridge());
    await tick();
    controller.stop();
    const record = JSON.parse(localStorage.getItem(MODEL_REFRESH_STORAGE_KEY)!);
    record.synthetic.revision = "1.5.5:old-content";
    localStorage.setItem(MODEL_REFRESH_STORAGE_KEY, JSON.stringify(record));
    controller = startModelUpgradeSync(bridge());
    await tick();
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });
  it("does not invent a source; waits for saved configuration and skips disabled/no-endpoint sources", async () => {
    mocks.profiles = [];
    controller = startModelUpgradeSync(bridge());
    await tick();
    expect(mocks.discover).not.toHaveBeenCalled();
    mocks.profiles = [
      profile(),
      { ...profile("off"), enabled: false },
      {
        ...profile("unsupported"),
        capabilities: { supportsModelsEndpoint: false },
      },
      profile("empty", ""),
    ];
    changed();
    await tick();
    expect(mocks.discover).toHaveBeenCalledTimes(1);
  });
  it("preserves cache offline, retries on connectivity, and bounds failure retry", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    controller = startModelUpgradeSync(bridge());
    await tick();
    expect(mocks.discover).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    mocks.discover.mockRejectedValue(new Error("synthetic failure"));
    window.dispatchEvent(new Event("online"));
    await tick(300_000);
    expect(mocks.discover).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem(MODEL_REFRESH_STORAGE_KEY)).toBeNull();
    await tick(300_000);
    expect(mocks.discover).toHaveBeenCalledTimes(4);
  });
  it("waits for account connection without blocking manual sources", async () => {
    mocks.profiles.push(profile("account", "tuzi-account:synthetic"));
    controller = startModelUpgradeSync(bridge("disconnected"));
    await tick(500);
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    controller.updateAccountBridge(bridge());
    await tick();
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });
  it.each(["remove", "disable", "key", "account"])(
    "aborts and rejects a stale %s source response",
    async (change) => {
      mocks.profiles = [profile("account", "tuzi-account:synthetic")];
      let options: any;
      let resolve!: () => void;
      mocks.discover.mockImplementation((_p, _f, opts) => {
        options = opts;
        return new Promise<void>((done) => {
          resolve = done;
        });
      });
      controller = startModelUpgradeSync(bridge());
      await tick();
      if (change === "remove") mocks.profiles = [];
      if (change === "disable") mocks.profiles[0].enabled = false;
      if (change === "key") mocks.profiles[0].apiKey = "tuzi-account:changed";
      if (change === "account")
        controller.updateAccountBridge(bridge("connected", 2));
      changed();
      expect(options.signal.aborted).toBe(true);
      expect(options.isCurrent()).toBe(false);
      resolve();
      await tick(1);
      expect(localStorage.getItem(MODEL_REFRESH_STORAGE_KEY)).toBeNull();
    },
  );
  it("does not mark refresh complete if catalog flush fails, and retries", async () => {
    mocks.flush.mockRejectedValueOnce(new Error("synthetic storage full"));
    controller = startModelUpgradeSync(bridge());
    await tick();
    expect(localStorage.getItem(MODEL_REFRESH_STORAGE_KEY)).toBeNull();
    await tick(6_000);
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(MODEL_REFRESH_STORAGE_KEY)).not.toBeNull();
  });
  it("waits for ongoing manual discovery instead of starting a duplicate", async () => {
    mocks.busy = true;
    controller = startModelUpgradeSync(bridge());
    await tick();
    expect(mocks.discover).not.toHaveBeenCalled();
    mocks.busy = false;
    await tick(1_200);
    expect(mocks.discover).toHaveBeenCalledTimes(1);
  });
});
