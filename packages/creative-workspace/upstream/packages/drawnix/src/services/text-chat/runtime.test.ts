import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../chat-storage-service", () => ({ chatStorageService: {} }));
vi.mock("./request", () => ({ requestTextChat: vi.fn() }));
const discussionMock = vi.hoisted(() => ({ request: vi.fn(), execute: vi.fn() }));
const setupGate = vi.hoisted(() => vi.fn(() => true));
vi.mock('../assistant-creation-setup', () => ({ ensureAssistantCreationConfigured: setupGate }));
vi.mock("./discussion", () => ({ requestDiscussion: discussionMock.request, executeDiscussionPlan: discussionMock.execute }));
vi.mock("../workspace-service", () => ({ workspaceService: { getState: () => ({ currentBoardId: "board" }) } }));
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
afterEach(() => { vi.useRealTimers(); setupGate.mockReturnValue(true); });
describe("isolated text conversations", () => {
  it('keeps the draft and creates no messages or request when setup is incomplete', async () => {
    const { runtime, request } = setup();
    const id = await runtime.create(model);
    runtime.configure(id, {}, { draft: '保留这条草稿' });
    setupGate.mockReturnValue(false);
    await runtime.send(id, '保留这条草稿');
    const session = runtime.getSnapshot().sessions[0];
    expect(session.textChat.draft).toBe('保留这条草稿');
    expect(session.textChat.messages).toEqual([]);
    expect(runtime.getSnapshot().running.size).toBe(0);
    expect(request).not.toHaveBeenCalled();
    setupGate.mockReturnValue(true);
    await runtime.send(id, '保留这条草稿');
    expect(request).toHaveBeenCalledTimes(1);
  });
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

it("persists attachment-only turns, restores refs and retains the unsent draft during retry", async () => {
  const { runtime, db, request } = setup();
  const id = await runtime.create(model);
  const attachment = {
    id: "image",
    name: "photo.jpg",
    kind: "image" as const,
    mimeType: "image/jpeg",
    size: 50,
  };
  await runtime.addDraftAttachment(id, attachment);
  await runtime.send(id, "");
  expect(request.mock.calls[0][0]).toMatchObject({
    sessionId: id,
    turns: [{ role: "user", content: "", attachments: [attachment] }],
  });
  const user = runtime.getSnapshot().sessions[0].textChat.messages[0];
  runtime.configure(
    id,
    {},
    {
      draft: "next question",
      draftAttachments: [{ ...attachment, id: "next" }],
    },
  );
  await runtime.send(id, "", user.id);
  expect(request.mock.calls[1][0].turns[0].attachments).toEqual([attachment]);
  const restored = new TextChatRuntime(db);
  await restored.initialize();
  expect(restored.getSnapshot().sessions[0].textChat).toMatchObject({
    draft: "next question",
    draftAttachments: [{ ...attachment, id: "next" }],
  });
});

it("shares a single discussion per board and persists independent sidebar draft", async () => {
  discussionMock.request.mockImplementation(async (r: any) => {
    await r.onTasks(["synthetic-task"]);
    return { content: "done", reasoning: "provider reasoning" };
  });
  const { runtime, db, request } = setup();
  const ids = await Promise.all([runtime.ensureDiscussion("board-a", model), runtime.ensureDiscussion("board-a", model)]);
  expect(ids[0]).toBe(ids[1]);
  expect(runtime.getSnapshot().sessions).toHaveLength(1);
  runtime.select(ids[0]);
  runtime.configure(ids[0], {}, { draft: "unsent sidebar draft", draftAttachments: [{ id: "sidebar-attachment", name: "note.txt", kind: "document", mimeType: "text/plain", size: 10 }] });
  await runtime.send(ids[0], "main input", undefined, { origin: "canvas" });
  expect(request).not.toHaveBeenCalled();
  expect(discussionMock.request.mock.calls.at(-1)[0].turns).toEqual([{role:"user",content:"main input"}]);
  const restored = new TextChatRuntime(db); await restored.initialize();
  expect(restored.getSnapshot().sessions[0].textChat).toMatchObject({
    executionMode: "agent", linkedBoardId: "board-a", draft: "unsent sidebar draft",
    draftAttachments: [{ id: "sidebar-attachment" }],
    messages: [{ origin: "canvas" }, { discussion: { boardId: "board-a", taskIds: ["synthetic-task"] } }],
  });
  await expect(runtime.send(ids[0], "", runtime.getSnapshot().sessions[0].textChat.messages[0].id)).rejects.toThrow("重复");
  const second = await runtime.ensureDiscussion("board-b", model);
  expect(second).not.toBe(ids[0]);
  runtime.reset(); expect(runtime.getSnapshot().activeId).toBeNull();
});
it("rejects malformed discussion metadata while preserving legacy sessions", async () => {
  const { runtime } = setup(); const id = await runtime.create(model);
  const original = runtime.getSnapshot().sessions[0];
  expect(restoreTextConversation(original).textChat.executionMode).toBeUndefined();
  const invalid = { ...original, textChat: { ...original.textChat, executionMode: "agent", linkedBoardId: "board-a", messages: [{ id: "assistant", role: "assistant", content: "ok", status: "complete", discussion: { boardId: "board-b", runId: "run", taskIds: [] } }] } };
  expect(() => restoreTextConversation(invalid as any)).toThrow("任务引用");
});

it("permits only a failed pre-submission sidebar retry, including after restart", async () => {
  discussionMock.request.mockReset();
  discussionMock.request.mockRejectedValueOnce(new Error("planning interrupted"));
  const {runtime,db}=setup(); const id=await runtime.ensureDiscussion("board",model);
  await runtime.send(id,"开始生成吧");
  const userId=runtime.getSnapshot().sessions[0].textChat.messages[0].id;
  const restored=new TextChatRuntime(db);await restored.initialize();
  discussionMock.request.mockImplementationOnce(async (r:any)=>{
    await r.onBeforeSubmit();
    const saved=await db.getAllSessions();
    expect(saved[0].textChat.messages.at(-1).discussion.submission).toBe("started");
    throw new Error("dispatch uncertain");
  });
  await restored.send(id,"",userId);
  expect(discussionMock.request).toHaveBeenCalledTimes(2);
  const again=new TextChatRuntime(db);await again.initialize();
  await expect(again.send(id,"",userId)).rejects.toThrow("重复");
});
it("never infers safe replay from empty task ids in legacy metadata", async () => {
  discussionMock.request.mockRejectedValue(new Error("failure"));
  const {runtime,db,records}=setup();const id=await runtime.ensureDiscussion("board",model);
  await runtime.send(id,"开始生成吧");
  const saved=records.get(id);delete saved.textChat.messages.at(-1).discussion.submission;
  const restored=new TextChatRuntime(db);await restored.initialize();
  await expect(restored.send(id,"",saved.textChat.messages[0].id)).rejects.toThrow("重复");
});

const pendingPlan = {version:1, status:'ready', steps:[{type:'text',prompt:'Write a story',count:1,model:'execution-model',modelRef:{profileId:'synthetic',modelId:'execution-model'}}]};
it('persists a plan, restores it and dispatches exactly once without another text request', async () => {
  discussionMock.request.mockReset().mockImplementation(async (r:any) => { await r.onPlan(pendingPlan); return {content:'preview',reasoning:''}; });
  const {runtime,db}=setup(); const id=await runtime.ensureDiscussion('board',model);
  await runtime.send(id,'write'); const recovered=new TextChatRuntime(db); await recovered.initialize();
  const m=recovered.getSnapshot().sessions[0].textChat.messages.at(-1)!;
  expect(m.discussion?.plan).toEqual(pendingPlan);
  discussionMock.execute.mockReset().mockImplementation(async (r:any) => {
    await r.onBeforeSubmit();
    expect((await db.getAllSessions())[0].textChat.messages.at(-1).discussion.plan.status).toBe('started');
    await r.onTasks(['result']);
  });
  await Promise.all([recovered.decidePlan(id,m.id,true),recovered.decidePlan(id,m.id,true)]);
  expect(discussionMock.execute).toHaveBeenCalledTimes(1); expect(discussionMock.request).toHaveBeenCalledTimes(1);
  const again=new TextChatRuntime(db); await again.initialize();
  await expect(again.decidePlan(id,m.id,true)).rejects.toThrow('已经');
});
it('cancellation is durable and never dispatches', async () => {
  discussionMock.request.mockReset().mockImplementation(async (r:any) => { await r.onPlan(pendingPlan); return {content:'preview',reasoning:''}; });
  discussionMock.execute.mockReset();
  const {runtime,db}=setup(); const id=await runtime.ensureDiscussion('board',model); await runtime.send(id,'write');
  const m=runtime.getSnapshot().sessions[0].textChat.messages.at(-1)!;
  await runtime.decidePlan(id,m.id,false);
  const again=new TextChatRuntime(db);await again.initialize();
  expect(again.getSnapshot().sessions[0].textChat.messages.at(-1)?.discussion?.plan?.status).toBe('cancelled');
  await expect(again.decidePlan(id,m.id,true)).rejects.toThrow(); expect(discussionMock.execute).not.toHaveBeenCalled();
});
it('validates restored plan counts, routes and submission states', async () => {
  const {runtime}=setup();const id=await runtime.ensureDiscussion('board',model);
  const session=runtime.getSnapshot().sessions[0];
  for (const plan of [{...pendingPlan,steps:[{...pendingPlan.steps[0],count:11}]},{...pendingPlan,steps:[{...pendingPlan.steps[0],model:'mismatch'}]},{...pendingPlan,status:'started'}]) {
    const s={...session,textChat:{...session.textChat,messages:[{id:'m',role:'assistant',content:'preview',status:'complete',discussion:{boardId:'board',runId:'run',taskIds:[],submission:'not_started',plan}}]}};
    expect(()=>restoreTextConversation(s as any)).toThrow();
  }
});
