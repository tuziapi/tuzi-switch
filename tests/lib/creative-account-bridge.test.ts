import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCreativeAccountBridge } from "@/features/creative/accountBridge";
import { disconnectedAccount } from "@/lib/api/account";
import { requestCreativeManual } from "@/features/creative/manualTransport";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), desktop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage?: (message: unknown) => void;
  },
}));
vi.mock("@/lib/api/account", async (original) => ({
  ...(await original<object>()),
  desktopRequest: mocks.desktop,
}));
const state = {
  ...disconnectedAccount,
  status: "connected" as const,
  generation: 9,
};
const reference = "tuzi-account:synthetic-binding";
const bridge = () => createCreativeAccountBridge(state, () => {});
const send = (action = "/v1/models", init: RequestInit = {}) =>
  bridge().request(reference, "https://api.tu-zi.com" + action, init);
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.desktop.mockReset();
});

describe("creative account native boundary", () => {
  it("passes source references and generation without renderer credentials", async () => {
    mocks.invoke.mockImplementation(async (command, args) => {
      expect(command).toBe("creative_account_request");
      expect(args.request).toMatchObject({
        generation: 9,
        bindingId: "synthetic-binding",
        action: "models",
      });
      expect(args.request).not.toHaveProperty("headers");
      expect(args.request).not.toHaveProperty("url");
      args.onChunk.onmessage({
        type: "start",
        status: 200,
        content_type: "application/json",
        headers: { "x-oneapi-request-id": "synthetic-request" },
      });
      args.onChunk.onmessage({
        type: "data",
        data: btoa('{"data":[{"id":"synthetic-model"}]}'),
      });
      args.onChunk.onmessage({ type: "end" });
    });
    const response = await send();
    expect(response.headers.get("x-oneapi-request-id")).toBe(
      "synthetic-request",
    );
    expect(await response.json()).toEqual({
      data: [{ id: "synthetic-model" }],
    });
  });
  it.each([
    "https://attacker.invalid/v1/models",
    "https://user@api.tu-zi.com/v1/models",
    "https://api.tu-zi.com/api/token/",
    "https://api.tu-zi.com/v1/models?key=secret",
    "https://api.tu-zi.com/v1/models#fragment",
  ])("rejects unsupported destinations before IPC: %s", async (url) => {
    await expect(bridge().request(reference, url, {})).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("requires connection and an actual reference", async () => {
    await expect(
      createCreativeAccountBridge(disconnectedAccount, () => {}).request(
        reference,
        "https://api.tu-zi.com/v1/models",
        {},
      ),
    ).rejects.toThrow("未连接");
    await expect(
      bridge().request("sk-SYNTHETIC", "https://api.tu-zi.com/v1/models", {}),
    ).rejects.toThrow("没有此关联");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("cancels a streaming request and does not replay it", async () => {
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "account_cancel_request") return Promise.resolve();
      args.onChunk.onmessage({
        type: "start",
        status: 200,
        content_type: "text/event-stream",
      });
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const response = await send("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "synthetic", stream: true }),
      signal: controller.signal,
    });
    controller.abort();
    await expect(response.text()).rejects.toThrow();
    expect(
      mocks.invoke.mock.calls.filter(
        ([name]) => name === "creative_account_request",
      ),
    ).toHaveLength(1);
    expect(
      mocks.invoke.mock.calls.filter(
        ([name]) => name === "account_cancel_request",
      ),
    ).toHaveLength(1);
  });
  it("does not expose native diagnostics or leave an unfinished stream hanging", async () => {
    mocks.invoke.mockRejectedValue("upstream says sk-SYNTHETIC-SECRET");
    await expect(send()).rejects.toThrow("配置操作失败");
    mocks.invoke.mockImplementation(async (_, args) => {
      args.onChunk.onmessage({
        type: "start",
        status: 200,
        content_type: "application/json",
      });
    });
    const response = await send();
    await expect(response.text()).rejects.toThrow("结果待确认");
  });
  it("fetches an explicitly selected Key outside the current page", async () => {
    mocks.desktop
      .mockResolvedValueOnce({ data: { items: [{ id: "1" }], has_more: true } })
      .mockResolvedValueOnce({
        data: { id: "99", name: "synthetic-selected" },
      });
    const result = await createCreativeAccountBridge(
      state,
      () => {},
      "99",
    ).listKeys(1, "");
    expect(result.items.map((key) => key.id)).toEqual(["99", "1"]);
    expect(mocks.desktop.mock.calls[1][0].path).toBe("/account/keys/99");
  });
  it("does not dispatch already cancelled requests", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      send("/v1/models", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("resends an early cancellation after native registration", async () => {
    let channel: { onmessage: (message: unknown) => void };
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "account_cancel_request") return Promise.resolve();
      channel = args.onChunk;
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const pending = send("/v1/models", { signal: controller.signal });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toThrow("Aborted");
    channel!.onmessage({ type: "ready" });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "account_cancel_request",
      ),
    ).toHaveLength(2);
  });
  it("removes abort listeners when the caller cancels a response body", async () => {
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "account_cancel_request") return Promise.resolve();
      args.onChunk.onmessage({ type: "ready" });
      args.onChunk.onmessage({
        type: "start",
        status: 200,
        content_type: "text/event-stream",
      });
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const response = await send("/v1/models", { signal: controller.signal });
    await response.body!.cancel();
    controller.abort();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "account_cancel_request",
      ),
    ).toHaveLength(1);
  });
  it("sends manual JSON bytes without depending on the account or its generation", async () => {
    mocks.invoke.mockImplementation(async (command, args) => {
      expect(command).toBe("creative_manual_request");
      expect(args.request).not.toHaveProperty("generation");
      expect(args.request.headers.authorization).toBe(
        "Bearer sk-synthetic-manual",
      );
      expect(JSON.parse(atob(args.request.body))).toEqual({
        model: "synthetic",
      });
      args.onChunk.onmessage({
        type: "start",
        status: 200,
        content_type: "application/json",
      });
      args.onChunk.onmessage({ type: "data", data: btoa('{"ok":true}') });
      args.onChunk.onmessage({ type: "end" });
    });
    const response = await requestCreativeManual(
      "http://127.0.0.1:9999/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer sk-synthetic-manual",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "synthetic" }),
      },
    );
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("external creative tool boundary", () => {
  it.each([
    ["chat-mj", "https://vercel.ddaiai.com/"],
    ["banana-prompt", "https://www.aiwind.org/"],
    ["pose-library", "https://www.posemaniacs.com/zh-Hans/poses"],
  ])("opens %s with only its fixed public URL", async (id, url) => {
    await bridge().openExternalTool!(id);
    expect(mocks.invoke).toHaveBeenCalledWith("open_external", { url });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.desktop).not.toHaveBeenCalled();
  });
  it.each([
    "javascript:alert(1)",
    "https://example.invalid/?key=synthetic",
    "__proto__",
  ])("rejects arbitrary external input %s", async (id) => {
    await expect(bridge().openExternalTool!(id)).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
