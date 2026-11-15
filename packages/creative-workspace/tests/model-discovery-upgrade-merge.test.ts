import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});
async function setup() {
  const makeModel = (id: string) => ({
    id,
    label: id,
    type: "image",
    vendor: "GPT",
  });
  const catalogs = [
    {
      profileId: "synthetic",
      discoveredAt: 1,
      discoveredModels: ["old-selected", "old-hidden", "removed"].map(
        makeModel,
      ),
      selectedModelIds: ["old-selected", "removed"],
    },
  ];
  vi.doMock("../upstream/packages/drawnix/src/utils/settings-manager", () => ({
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID: "legacy-default",
    providerCatalogsSettings: {
      get: () => catalogs,
      addListener: vi.fn(),
      update: vi.fn(),
      removeListener: vi.fn(),
    },
    providerProfilesSettings: {
      get: () => [{ id: "synthetic", enabled: true }],
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    invocationPresetsSettings: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    settingsManager: {
      getSetting: () => ({}),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  }));
  const { runtimeModelDiscovery: store } = await import(
    "../upstream/packages/drawnix/src/utils/runtime-model-discovery"
  );
  return store;
}
const response = (ids: string[]) =>
  Response.json({ data: ids.map((id) => ({ id })) });

describe("upgrade catalog merge against current state", () => {
  it("adds only new authorized IDs, preserves deselections and edits made while fetching", async () => {
    const store = await setup();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const pending = store.discover(
      "synthetic",
      "https://synthetic.invalid/v1",
      "SYNTHETIC",
      [],
      {
        selectNew: true,
        modelMetadata: [
          { id: "not-authorized", description: "not available" },
          {
            id: "gpt-image-2.6-flare",
            description: "claims deferred SVG support",
          },
        ],
      },
    );
    store.addManualModel("synthetic", { id: "user-added", type: "image" });
    store.applySelection("synthetic", ["user-added"]);
    resolve(response(["old-selected", "old-hidden", "gpt-image-2.6-flare"]));
    await pending;
    const state = store.getState("synthetic");
    expect(state.selectedModelIds.sort()).toEqual([
      "gpt-image-2.6-flare",
      "user-added",
    ]);
    expect(state.discoveredModels.map((m) => m.id)).not.toContain("removed");
    expect(state.discoveredModels.map((m) => m.id)).not.toContain(
      "not-authorized",
    );
    expect(
      state.models.find((m) => m.id === "gpt-image-2.6-flare")?.description,
    ).toContain("暂未接入");
  });
  it("rejects an obsolete source before it commits models", async () => {
    const store = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(["gpt-image-2.6-flare"])),
    );
    await expect(
      store.discover(
        "synthetic",
        "https://synthetic.invalid/v1",
        "SYNTHETIC",
        [],
        {
          selectNew: true,
          isCurrent: () => false,
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.getState("synthetic").selectedModelIds).toEqual([
      "old-selected",
      "removed",
    ]);
    expect(store.isDiscovering("synthetic")).toBe(false);
  });
  it("prevents an older background request overwriting a newer manual refresh", async () => {
    const store = await setup();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValueOnce(response(["gpt-image-2.6-sunburst"])),
    );
    const first = store.discover(
      "synthetic",
      "https://synthetic.invalid/v1",
      "SYNTHETIC",
      [],
      { selectNew: true },
    );
    const assertion = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await store.discover(
      "synthetic",
      "https://synthetic.invalid/v1",
      "SYNTHETIC",
      [],
      { selectAll: true },
    );
    resolve(response(["gpt-image-2.6-flare"]));
    await assertion;
    expect(store.getState("synthetic").selectedModelIds).toEqual([
      "gpt-image-2.6-sunburst",
    ]);
  });
  it.each([[], null])(
    "preserves old models on empty/malformed data: %s",
    async (data) => {
      const store = await setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ data })),
      );
      await expect(
        store.discover(
          "synthetic",
          "https://synthetic.invalid/v1",
          "SYNTHETIC",
          [],
          { selectNew: true },
        ),
      ).rejects.toThrow();
      expect(store.getState("synthetic").selectedModelIds).toEqual([
        "old-selected",
        "removed",
      ]);
    },
  );
});
