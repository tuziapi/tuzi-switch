export interface CreativeAccountState {
  status: string;
  generation: number;
  identity: { userId: string; displayName: string; username: string } | null;
}
export interface CreativeAccountKey {
  id: string;
  name: string;
  masked_key: string;
  group: string;
  status: number;
  is_expired?: boolean;
  expired_time: number;
}
export interface CreativeAccountBinding {
  schemaVersion: 1;
  id: string;
  accountOrigin: string;
  userId: string;
  tokenId: string;
  name: string;
  keyMask: string;
  group: string;
  updatedAt: number;
}
export interface CreativeAccountBridge {
  state: CreativeAccountState;
  selectedKeyId?: string;
  manageAccount: () => void;
  /** Only built-in public tool IDs; never accepts credentials or arbitrary URLs. */
  openExternalTool?: (toolId: string) => Promise<void>;
  /** Native manual transport is independent of account connection state. */
  requestManual?: (url: string, init: RequestInit) => Promise<Response>;
  listKeys: (
    page: number,
    search: string,
  ) => Promise<{ items: CreativeAccountKey[]; has_more: boolean }>;
  listBindings: () => Promise<CreativeAccountBinding[]>;
  bindKey: (tokenId: string) => Promise<CreativeAccountBinding>;
  request: (
    reference: string,
    url: string,
    init: RequestInit,
  ) => Promise<Response>;
}
