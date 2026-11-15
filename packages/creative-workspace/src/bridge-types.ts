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
  /** Optional native discussion backend; independent of Rabbit account login. */
  localCodex?: CreativeCodexBridge;
  state: CreativeAccountState;
  selectedKeyId?: string;
  manageAccount: () => void;
  /** Only built-in public tool IDs; never accepts credentials or arbitrary URLs. */
  openExternalTool?: (toolId: string) => Promise<void>;
  /** Native manual transport is independent of account connection state. */
  requestManual?: (url: string, init: RequestInit) => Promise<Response>;
  /** User-triggered image operations. No arbitrary destination path or URL. */
  imageAction?: (
    action: "copy" | "save" | "reveal",
    blob: Blob,
    name?: string,
  ) => Promise<"copied" | "saved" | "revealed" | "cancelled">;
  copyText?: (text: string) => Promise<void>;
  /** Save original media through a native dialog; no caller-controlled path. */
  saveMedia?: (
    blob: Blob,
    name: string,
    kind: "video" | "audio" | "archive",
  ) => Promise<"saved" | "cancelled">;
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

export interface CreativeCodexModel {
  id: string;
  name: string;
  efforts: string[];
  defaultEffort: string | null;
  supportsImages: boolean;
}
export interface CreativeCodexBridge {
  probe: () => Promise<{ models: CreativeCodexModel[]; defaultModel: string }>;
  request: (input: {
    model: string;
    effort?: string;
    prompt: string;
    images: string[];
    signal: AbortSignal;
    onUpdate: (value: { content: string; reasoning: string }) => void;
  }) => Promise<{ content: string; reasoning: string }>;
}
