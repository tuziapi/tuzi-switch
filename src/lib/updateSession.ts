import type { UpdateHandle, UpdateProgressEvent } from "./updater";

export type InstallPhase =
  | "idle"
  | "downloading"
  | "verifying"
  | "ready"
  | "preparing"
  | "installing"
  | "installed"
  | "error";
export interface InstallState {
  phase: InstallPhase;
  downloaded: number;
  total: number;
  error: string | null;
}
export const initialInstallState: InstallState = {
  phase: "idle",
  downloaded: 0,
  total: 0,
  error: null,
};

/** One pinned update, shared by every UI entry. Never installs during download. */
export class UpdateSession {
  state: InstallState = initialInstallState;
  private busy = false;
  constructor(
    readonly handle: UpdateHandle,
    private notify: (state: InstallState) => void,
    private prepare: () => Promise<void>,
    private relaunch: () => Promise<void>,
  ) {}
  private set(change: Partial<InstallState>) {
    this.state = { ...this.state, ...change };
    this.notify(this.state);
  }
  async download(): Promise<void> {
    if (this.busy || ["ready", "installed"].includes(this.state.phase)) return;
    if (this.handle.manual || !this.handle.download || !this.handle.install)
      throw Error("此版本不支持应用内更新");
    this.busy = true;
    this.set({ phase: "downloading", downloaded: 0, total: 0, error: null });
    try {
      await this.handle.download((event: UpdateProgressEvent) => {
        if (event.event === "Started")
          this.set({ total: event.total ?? 0, downloaded: 0 });
        if (event.event === "Progress")
          this.set({
            downloaded: this.state.downloaded + (event.downloaded ?? 0),
          });
        if (event.event === "Finished") this.set({ phase: "verifying" });
      });
      this.set({ phase: "ready" }); // Native signature verification has resolved.
    } catch {
      this.set({
        phase: "error",
        error: "下载或签名校验失败，尚未安装更新。请检查网络后重试。",
      });
    } finally {
      this.busy = false;
    }
  }
  async installAndRestart(): Promise<void> {
    if (this.busy || !["ready", "installed"].includes(this.state.phase)) return;
    this.busy = true;
    const alreadyInstalled = this.state.phase === "installed";
    this.set({ phase: "preparing", error: null });
    try {
      await this.prepare();
    } catch (error) {
      this.set({
        phase: alreadyInstalled ? "installed" : "ready",
        error:
          error instanceof Error
            ? error.message
            : "请先完成任务并保存作品，再重试更新。",
      });
      this.busy = false;
      return;
    }
    try {
      if (!alreadyInstalled) {
        this.set({ phase: "installing" });
        // Windows may exit here; all guards must run BEFORE install().
        await this.handle.install!();
      }
      this.set({ phase: "installed" });
      await this.relaunch();
    } catch {
      this.set(
        this.state.phase === "installed"
          ? { error: "更新已安装，自动重启失败。请退出并重新打开兔子助手。" }
          : {
              phase: "error",
              error:
                "安装未完成，请重新下载后重试。若从 DMG 中运行，请先将兔子助手安装到“应用程序”。",
            },
      );
    } finally {
      this.busy = false;
    }
  }
}
