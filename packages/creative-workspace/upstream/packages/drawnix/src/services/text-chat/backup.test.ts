import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  flush: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
  running: new Set<string>(),
}));
vi.mock("localforage", () => ({
  default: {
    createInstance: ({ name, storeName }: any) => {
      const id = `${name}/${storeName}`;
      if (!state.stores.has(id)) state.stores.set(id, new Map());
      const data = state.stores.get(id)!;
      return {
        iterate: async (f: any) => {
          for (const [key, value] of data) f(value, key);
        },
        setItem: async (key: string, value: unknown) =>
          data.set(key, structuredClone(value)),
        clear: async () => data.clear(),
      };
    },
  },
}));
vi.mock("./runtime", () => ({
  textChatRuntime: {
    flush: state.flush,
    reload: state.reload,
    getSnapshot: () => ({ running: state.running }),
  },
}));
vi.mock("../../utils/settings-manager", () => ({
  settingsManager: {
    waitForInitialization: async () => {},
    getSettings: () => ({ gemini: {}, providerProfiles: [] }),
    updateSettings: async () => {},
  },
}));
vi.mock("../kv-storage-service", () => ({
  kvStorageService: {
    keys: async () => [],
    getMany: async () => new Map(),
    setMany: async () => {},
    remove: async () => {},
  },
}));
vi.mock("../app-database", () => ({
  APP_DB_NAME: "synthetic",
  APP_DB_STORES: { CONFIG: "config", WORKFLOWS: "workflows" },
}));
vi.mock("../backup-restore/idb-store-backup", () => ({
  readStoreRecords: async () => [],
  writeStoreRecords: async () => 0,
  clearStore: async () => {},
  deleteStoreRecord: async () => {},
}));
vi.mock("../backup-restore/backup-checksum", () => ({
  checksumJson: async () => "synthetic-checksum",
}));
vi.mock("../audio-playlist-service", () => ({
  audioPlaylistService: { initialize: async () => {} },
}));
vi.mock("../character-storage-service", () => ({
  characterStorageService: {
    init: async () => {},
    getCharacters: () => [],
    clearAll: async () => {},
  },
}));
vi.mock("../character-avatar-cache-service", () => ({
  characterAvatarCacheService: { clearAll: async () => {} },
}));
vi.mock("../github-sync/token-service", () => ({ tokenService: {} }));
vi.mock("../github-sync/sync-password-service", () => ({
  syncPasswordService: {},
}));
import {
  exportEnvironmentData,
  importEnvironmentData,
} from "../backup-restore/environment-backup-service";
beforeEach(() => {
  state.stores.clear();
  state.running.clear();
  vi.clearAllMocks();
});
it("round-trips every text field in the existing environment backup, retaining old sessions", async () => {
  const session = {
    id: "text",
    kind: "text",
    title: "Synthetic",
    sessionModel: "synthetic",
    sessionModelRef: { profileId: "synthetic", modelId: "synthetic" },
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    textChat: {
      version: 1,
      draft: "unsent",
      systemPrompt: "system",
      maxOutput: 512,
      messages: [
        {
          id: "answer",
          role: "assistant",
          content: "partial",
          reasoning: "thinking",
          status: "stopped",
          replyTo: "user",
          createdAt: 2,
          model: "synthetic",
          finishReason: "length",
          usage: { input: 10, output: 20 },
        },
      ],
    },
  };
  const old = { id: "legacy", title: "Creative" };
  state.stores.set(
    "aitu-chat/sessions",
    new Map([
      ["text", session],
      ["legacy", old],
    ]),
  );
  state.flush.mockImplementationOnce(async () => {
    session.textChat.draft = "latest unsent";
  });
  const exported = await exportEnvironmentData(false);
  expect(state.flush).toHaveBeenCalledOnce();
  state.stores.clear();
  await importEnvironmentData(JSON.parse(JSON.stringify(exported.data)), {
    mode: "replace",
  });
  expect(state.stores.get("aitu-chat/sessions")?.get("text")).toEqual(session);
  expect(state.stores.get("aitu-chat/sessions")?.get("legacy")).toEqual(old);
  expect(state.reload).toHaveBeenCalledOnce();
});
it("refuses restore while a conversation is still generating", async () => {
  const exported = await exportEnvironmentData(false);
  state.running.add("synthetic");
  await expect(
    importEnvironmentData(exported.data, { mode: "replace" }),
  ).rejects.toThrow("停止文本回复");
  expect(state.reload).not.toHaveBeenCalled();
});
