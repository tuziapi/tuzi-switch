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
      executionMode: "agent",
      linkedBoardId: "synthetic-board",
      systemPrompt: "system",
      maxOutput: 512,
      messages: [
        {
          id: "answer",
          discussion: { boardId: "synthetic-board", runId: "synthetic-run", taskIds: ["synthetic-task"], submission: "started", plan: {version:1,status:"started",steps:[{type:"text",prompt:"synthetic",count:1,model:"synthetic",modelRef:{profileId:"synthetic",modelId:"synthetic"}}]} },
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

it("round-trips image and extracted PDF payloads in the optional backup store", async () => {
  const image = {
    ref: {
      id: "image",
      name: "photo.jpg",
      kind: "image",
      mimeType: "image/jpeg",
      size: 4,
    },
    sessionId: "text",
    dataUrl: "data:image/jpeg;base64,YWJj",
  };
  const pdf = {
    ref: {
      id: "pdf",
      name: "notes.pdf",
      kind: "document",
      mimeType: "application/pdf",
      size: 4,
      pages: 1,
    },
    sessionId: "text",
    text: "Synthetic PDF",
  };
  state.stores.set(
    "aitu-chat/text_attachments",
    new Map([
      ["image", image],
      ["pdf", pdf],
    ]),
  );
  const { data } = await exportEnvironmentData(false);
  state.stores.clear();
  await importEnvironmentData(JSON.parse(JSON.stringify(data)), {
    mode: "replace",
  });
  expect(state.stores.get("aitu-chat/text_attachments")?.get("image")).toEqual(
    image,
  );
  expect(state.stores.get("aitu-chat/text_attachments")?.get("pdf")).toEqual(
    pdf,
  );
  delete data.localForage.textAttachments;
  await importEnvironmentData(data, { mode: "replace" });
  expect(state.stores.get("aitu-chat/text_attachments")?.size).toBe(0);
});
it("preflights malformed attachment backups before clearing existing data", async () => {
  state.stores.set("aitu-chat/sessions", new Map([["keep", { id: "keep" }]]));
  const { data } = await exportEnvironmentData(false);
  data.localForage.textAttachments = [{ key: "bad", value: {} }];
  await expect(
    importEnvironmentData(data, { mode: "replace" }),
  ).rejects.toThrow("附件");
  expect(state.stores.get("aitu-chat/sessions")?.has("keep")).toBe(true);
  expect(state.reload).not.toHaveBeenCalled();
});
