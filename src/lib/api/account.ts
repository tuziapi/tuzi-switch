import { invoke } from "@tauri-apps/api/core";

/** Public native projection. OAuth secrets never cross this boundary. */
export interface AccountState {
  status:
    | "disconnected"
    | "authorizing"
    | "exchanging"
    | "verifying"
    | "connected"
    | "refreshing"
    | "offline"
    | "invalid"
    | "error";
  generation: number;
  revision?: number;
  identity: {
    userId: string;
    username: string;
    displayName: string;
    connectionId: string;
  } | null;
  error: { code: string; message: string; retryAfter?: number | null } | null;
  localCleared: boolean;
  remoteRevoked: boolean | null;
  expiresAt: number | null;
  grantExpiresAt: number | null;
}

export const disconnectedAccount: AccountState = {
  status: "disconnected",
  generation: 0,
  identity: null,
  error: null,
  localCleared: true,
  remoteRevoked: null,
  expiresAt: null,
  grantExpiresAt: null,
};
export const accountApi = {
  getState: () => invoke<AccountState>("account_get_state"),
  startLogin: () => invoke<AccountState>("account_start_login"),
  cancelLogin: () => invoke<AccountState>("account_cancel_login"),
  logout: () => invoke<AccountState>("account_logout"),
  retry: () => invoke<AccountState>("account_retry"),
};

export type WebTarget =
  | "topup"
  | "redemption"
  | "personal"
  | "coding"
  | "gaccode";
export interface DesktopRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: [string, string][];
  body?: unknown;
  generation: number;
}
export const desktopRequest = async <T>(
  request: DesktopRequest,
  signal?: AbortSignal,
) => {
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invoke("account_cancel_request", { requestId }).catch(() => {});
  };
  if (signal?.aborted) throw new Error("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await invoke<import("./desktop").Envelope<T>>(
      "account_request",
      { request: { ...request, requestId } },
    );
    if (signal?.aborted) throw new Error("cancelled");
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
};
export const openAccountWeb = (target: WebTarget) =>
  invoke<void>("account_open_web", { target });
