import { describe, expect, it, vi } from "vitest";
import { UpdateSession } from "@/lib/updateSession";
import type { UpdateHandle, UpdateProgressEvent } from "@/lib/updater";
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup(download = vi.fn().mockResolvedValue(undefined)) {
  const install = vi.fn().mockResolvedValue(undefined),
    prepare = vi.fn().mockResolvedValue(undefined),
    restart = vi.fn().mockResolvedValue(undefined);
  const handle: UpdateHandle = {
    version: "1.5.2",
    download,
    install,
    downloadAndInstall: vi.fn(),
  };
  const session = new UpdateSession(handle, vi.fn(), prepare, restart);
  return { session, handle, download, install, prepare, restart };
}
describe("download first, explicit guarded install", () => {
  it("does not install on download completion; Finished alone is not verified", async () => {
    const pending = deferred();
    let progress!: (event: UpdateProgressEvent) => void;
    const x = setup(
      vi.fn((cb) => {
        progress = cb;
        return pending.promise;
      }),
    );
    const first = x.session.download();
    await x.session.download();
    expect(x.download).toHaveBeenCalledTimes(1);
    progress({ event: "Started", total: 100 });
    progress({ event: "Progress", downloaded: 40 });
    expect(x.session.state.downloaded).toBe(40);
    progress({ event: "Finished" });
    expect(x.session.state.phase).toBe("verifying");
    await x.session.installAndRestart();
    expect(x.install).not.toHaveBeenCalled();
    pending.resolve();
    await first;
    expect(x.session.state.phase).toBe("ready");
    expect(x.restart).not.toHaveBeenCalled();
    expect(x.install).not.toHaveBeenCalled();
    await x.session.installAndRestart();
    expect(x.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      x.install.mock.invocationCallOrder[0],
    );
    expect(x.install.mock.invocationCallOrder[0]).toBeLessThan(
      x.restart.mock.invocationCallOrder[0],
    );
    expect(x.handle.downloadAndInstall).not.toHaveBeenCalled();
  });
  it("rejects corrupt download after transfer finishes and permits retry", async () => {
    const x = setup(
      vi.fn(async (cb) => {
        cb({ event: "Finished" });
        throw Error("signature mismatch");
      }),
    );
    await x.session.download();
    await x.session.installAndRestart();
    expect(x.session.state.phase).toBe("error");
    expect(x.install).not.toHaveBeenCalled();
    x.download.mockResolvedValue(undefined);
    await x.session.download();
    expect(x.session.state.phase).toBe("ready");
  });
  it("blocks before install for running tasks or persistence failure and keeps download", async () => {
    const x = setup();
    await x.session.download();
    x.prepare.mockRejectedValue(Error("生成中"));
    await x.session.installAndRestart();
    expect(x.install).not.toHaveBeenCalled();
    expect(x.session.state.error).toBe("生成中");
    expect(x.session.state.phase).toBe("ready");
    x.prepare.mockResolvedValue(undefined);
    await x.session.installAndRestart();
    expect(x.install).toHaveBeenCalledTimes(1);
    expect(x.download).toHaveBeenCalledTimes(1);
  });
  it("deduplicates install clicks and retains installed state when restart fails", async () => {
    const x = setup(),
      pending = deferred();
    await x.session.download();
    x.install.mockReturnValue(pending.promise);
    x.restart.mockRejectedValue(Error("restart unavailable"));
    const first = x.session.installAndRestart();
    await x.session.installAndRestart();
    pending.resolve();
    await first;
    expect(x.session.state.phase).toBe("installed");
    expect(x.install).toHaveBeenCalledTimes(1);
    await x.session.installAndRestart();
    expect(x.install).toHaveBeenCalledTimes(1);
    expect(x.restart).toHaveBeenCalledTimes(2);
  });
  it("does not relaunch when installation fails", async () => {
    const x = setup();
    await x.session.download();
    x.install.mockRejectedValue(Error("readonly"));
    await x.session.installAndRestart();
    expect(x.session.state.phase).toBe("error");
    expect(x.restart).not.toHaveBeenCalled();
  });
});
