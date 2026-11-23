import { describe, expect, it, vi } from "vitest";
import type { CreativeAccountBridge } from "../src/bridge-types";
import {
  readEcommerceImage,
  resolveEcommerceAccountReference,
  waitForEcommerceRequest,
} from "../src/ecommerce-request";

function bridge(native = true) {
  return {
    selectedKeyId: "synthetic-account-key",
    requestManual: native ? vi.fn() : undefined,
    bindKey: vi.fn().mockResolvedValue({ id: "synthetic-binding" }),
  } as unknown as CreativeAccountBridge;
}

describe("ecommerce request lifecycle", () => {
  it("keeps the configured model credential even with an unrelated selected account key", async () => {
    const host = bridge();
    expect(
      await resolveEcommerceAccountReference("synthetic-manual-key", host),
    ).toBeUndefined();
    expect(host.bindKey).not.toHaveBeenCalled();
  });
  it("keeps the configured account binding", async () => {
    const host = bridge();
    expect(
      await resolveEcommerceAccountReference("tuzi-account:existing", host),
    ).toBeUndefined();
    expect(host.bindKey).not.toHaveBeenCalled();
  });
  it("binds the selected account key only when the model has no credential", async () => {
    const host = bridge();
    expect(await resolveEcommerceAccountReference("", host)).toBe(
      "tuzi-account:synthetic-binding",
    );
    expect(host.bindKey).toHaveBeenCalledWith("synthetic-account-key");
  });
  it("fails account routes before IPC when the browser has no native bridge", async () => {
    const host = bridge(false);
    await expect(resolveEcommerceAccountReference("", host)).rejects.toThrow(
      "桌面原生连接",
    );
    await expect(
      resolveEcommerceAccountReference("tuzi-account:existing", host),
    ).rejects.toThrow("桌面原生连接");
    expect(host.bindKey).not.toHaveBeenCalled();
  });
  it("still permits manual browser credentials", async () => {
    expect(
      await resolveEcommerceAccountReference(
        "synthetic-manual-key",
        bridge(false),
      ),
    ).toBeUndefined();
    await expect(
      resolveEcommerceAccountReference("", undefined),
    ).rejects.toThrow("配置 API Key");
  });
  it("exits a stalled operation on abort and ignores its late result without replaying it", async () => {
    const controller = new AbortController();
    let finish!: (value: string[]) => void;
    const operation = new Promise<string[]>((resolve) => {
      finish = resolve;
    });
    const waiting = waitForEcommerceRequest(operation, controller.signal);
    const assertion = expect(waiting).rejects.toThrow("synthetic deadline");
    controller.abort(new Error("synthetic deadline"));
    await assertion;
    finish(["late-result"]);
    await Promise.resolve();
  });
  it("propagates success and provider errors", async () => {
    const controller = new AbortController();
    expect(
      await waitForEcommerceRequest(
        Promise.resolve(["image"]),
        controller.signal,
      ),
    ).toEqual(["image"]);
    await expect(
      waitForEcommerceRequest(
        Promise.reject(new Error("provider failed")),
        controller.signal,
      ),
    ).rejects.toThrow("provider failed");
  });
  it("reads reference bytes and rejects already cancelled reads", async () => {
    const controller = new AbortController();
    const file = new File(["synthetic"], "reference.png", {
      type: "image/png",
    });
    expect(await readEcommerceImage(file, controller.signal)).toBe(
      "data:image/png;base64,c3ludGhldGlj",
    );
    controller.abort();
    await expect(
      readEcommerceImage(file, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
