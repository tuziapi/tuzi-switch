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
