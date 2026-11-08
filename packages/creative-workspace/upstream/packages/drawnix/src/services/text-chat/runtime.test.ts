import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../chat-storage-service", () => ({ chatStorageService: {} }));
vi.mock("./request", () => ({ requestTextChat: vi.fn() }));
import { TextChatRuntime } from "./runtime";
import { conversationContext, restoreTextConversation } from "./conversation";
import type { TextChatRequest } from "./request";

function setup(
  request = vi.fn(async (_r: TextChatRequest) => ({
    content: "answer",
    reasoning: "",
  })),
) {
  const records = new Map<string, any>();
  let seq = 0;
  const db = {
    getAllSessions: vi.fn(async () => [...records.values()]),
    saveTextSession: vi.fn(async (s: any) => {
      records.set(s.id, structuredClone(s));
    }),
    deleteSession: vi.fn(async (id: string) => {
      records.delete(id);
    }),
    generateId: () => `test-${++seq}`,
    generateTitle: (s: string) => s.slice(0, 40),
  };
  return { runtime: new TextChatRuntime(db, request), db, records, request };
}
const model = { profileId: "synthetic", modelId: "synthetic-text" };
afterEach(() => vi.useRealTimers());
describe("isolated text conversations", () => {
  it("saves one atomic session with draft and replies, recoverable on restart", async () => {
    const { runtime, db } = setup();
    const id = await runtime.create(model);
    runtime.configure(id, {}, { draft: "draft", systemPrompt: "system" });
    await runtime.save(id);
    await runtime.send(id, "hello");
    const recovered = new TextChatRuntime(db);
    await recovered.initialize();
    expect(recovered.getSnapshot().sessions[0].textChat).toMatchObject({
      version: 1,
      draft: "",
      systemPrompt: "system",
      messages: [
        { content: "hello" },
        { content: "answer", status: "complete" },
      ],
    });
  });
  it("regenerates using only preceding context and retains old answers", async () => {
    const { runtime, request } = setup();
    const id = await runtime.create(model);
    await runtime.send(id, "first");
    await runtime.send(id, "second");
    const first = runtime.getSnapshot().sessions[0].textChat.messages[0];
    await runtime.send(id, "", first.id);
    expect(request.mock.calls[2][0].turns).toEqual([
      { role: "user", content: "first" },
    ]);
    expect(runtime.getSnapshot().sessions[0].textChat.messages).toHaveLength(5);
  });
  it("isolates cancellation and keeps partial output in the original session", async () => {
    const request = vi.fn(
      (r: TextChatRequest) =>
        new Promise<{ content: string; reasoning: string }>(
          (resolve, reject) => {
            r.onUpdate({ content: r.turns.at(-1)!.content, reasoning: "" });
            r.signal.addEventListener("abort", () =>
              reject(new DOMException("stop", "AbortError")),
            );
            if (r.turns.at(-1)!.content === "second")
              resolve({ content: "second complete", reasoning: "" });
          },
        ),
    );
    const { runtime } = setup(request);
    const a = await runtime.create(model),
      b = await runtime.create(model);
    const first = runtime.send(a, "first");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await runtime.send(b, "second");
    runtime.stop(a);
    await first;
    expect(
      runtime.getSnapshot().sessions.find((s) => s.id === a)!.textChat
        .messages[1],
    ).toMatchObject({ content: "first", status: "stopped" });
    expect(
      runtime.getSnapshot().sessions.find((s) => s.id === b)!.textChat
        .messages[1],
    ).toMatchObject({ content: "second complete", status: "complete" });
  });
  it("never submits when the first durable write fails", async () => {
    const { runtime, db, request } = setup();
    const id = await runtime.create(model);
    db.saveTextSession.mockRejectedValue(new Error("disk full"));
    await runtime.send(id, "keep me");
    expect(request).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().saveErrors.has(id)).toBe(true);
    expect(runtime.getSnapshot().sessions[0].textChat.messages[0].content).toBe(
      "keep me",
    );
  });
  it("keeps final save errors visible and retries without another request", async () => {
    const { runtime, db, request } = setup();
    const id = await runtime.create(model);
    db.saveTextSession
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    await runtime.send(id, "hello");
    expect(runtime.getSnapshot().saveErrors.has(id)).toBe(true);
    db.saveTextSession.mockImplementation(async () => {});
    await runtime.save(id);
    expect(runtime.getSnapshot().saveErrors.size).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("persists unchanged successful snapshots without notifying UI subscribers", async () => {
    const { runtime, db } = setup();
    const id = await runtime.create(model);
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    const snapshot = runtime.getSnapshot();
    await runtime.save(id);
    expect(db.saveTextSession).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    db.saveTextSession.mockRejectedValueOnce(new Error("disk full"));
    await expect(runtime.save(id)).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    await runtime.save(id);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot().saveErrors.has(id)).toBe(false);
    unsubscribe();
  });
  it("recovers in-progress messages as interrupted and ignores legacy creative sessions", async () => {
    const { runtime, db, records } = setup();
    const id = await runtime.create(model);
    const saved = records.get(id);
    saved.textChat.messages.push({
      id: "partial",
      role: "assistant",
      content: "partial",
      status: "streaming",
      createdAt: 1,
    });
    records.set("old", { id: "old", title: "creative" });
    const recovered = new TextChatRuntime(db);
    await recovered.initialize();
    expect(recovered.getSnapshot().sessions).toHaveLength(1);
    expect(
      recovered.getSnapshot().sessions[0].textChat.messages[0],
    ).toMatchObject({
      content: "partial",
      reasoning: "",
      status: "interrupted",
    });
  });
  it("does not replay failed/partial assistant text into future context", async () => {
    const { runtime } = setup();
    const id = await runtime.create(model);
    await runtime.send(id, "a");
    await runtime.send(id, "b");
    const messages = runtime.getSnapshot().sessions[0].textChat.messages;
    const input = messages.map((m) =>
      m.role === "assistant" ? { ...m, status: "stopped" as const } : m,
    );
    expect(conversationContext(input, messages[2].id)).toEqual([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
  });
  it("rejects unknown schema instead of deleting it", () => {
    expect(() =>
      restoreTextConversation({
        kind: "text",
        textChat: { version: 99 },
      } as any),
    ).toThrow("版本");
  });
  it("flush retries failed writes even when there are no timers or active requests", async () => {
    const { runtime, db } = setup();
    const id = await runtime.create(model);
    db.saveTextSession.mockRejectedValue(new Error("disk full"));
    await runtime.send(id, "retain");
    await expect(runtime.flush()).rejects.toThrow("保存失败");
    db.saveTextSession.mockResolvedValue(undefined);
    await runtime.flush();
    expect(runtime.getSnapshot().saveErrors.size).toBe(0);
  });
  it("reset during loading cannot resurrect cleared history", async () => {
    const { runtime, db } = setup();
    await runtime.create(model);
    let resolve!: (sessions: any[]) => void;
    db.getAllSessions.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const recovered = new TextChatRuntime(db);
    const pending = recovered.initialize();
    recovered.reset();
    resolve(runtime.getSnapshot().sessions);
    await pending;
    expect(recovered.getSnapshot().sessions).toEqual([]);
  });
  it("reset cancels active replies and prevents delayed persistence", async () => {
    const request = vi.fn(
      (r: TextChatRequest) =>
        new Promise<any>((_, reject) => {
          r.onUpdate({ content: "partial", reasoning: "" });
          r.signal.addEventListener("abort", () => reject(Error("cancel")));
        }),
    );
    const { runtime, db } = setup(request);
    const id = await runtime.create(model);
    const running = runtime.send(id, "hello");
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    const writes = db.saveTextSession.mock.calls.length;
    runtime.reset();
    await running;
    expect(runtime.getSnapshot().sessions).toEqual([]);
    expect(db.saveTextSession).toHaveBeenCalledTimes(writes);
  });
  it("deletes the full text session snapshot", async () => {
    const { runtime, records } = setup();
    const id = await runtime.create(model);
    await runtime.send(id, "a");
    await runtime.remove(id);
    expect(records.has(id)).toBe(false);
    expect(runtime.getSnapshot().sessions).toHaveLength(0);
  });
});
