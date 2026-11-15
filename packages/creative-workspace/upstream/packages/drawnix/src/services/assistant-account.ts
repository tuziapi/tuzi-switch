import type { CreativeAccountBridge } from "../../../../../src/bridge-types";
export const ACCOUNT_REFERENCE_PREFIX = "tuzi-account:";
export const ASSISTANT_ACCOUNT_CHANGED = "tuzi-assistant-account-changed";
export const ASSISTANT_OPEN_SETTINGS = "tuzi-assistant-open-creative-settings";
let current: CreativeAccountBridge | undefined;
export const getAssistantAccount = () => current;
export function setAssistantAccount(bridge: CreativeAccountBridge | undefined) {
  current = bridge;
  window.dispatchEvent(new Event(ASSISTANT_ACCOUNT_CHANGED));
}
export const isAccountReference = (value?: string | null) =>
  Boolean(value?.startsWith(ACCOUNT_REFERENCE_PREFIX));
export function accountReferenceFromHeaders(
  headers?: HeadersInit,
): string | null {
  const values = new Headers(headers);
  for (const value of [
    values.get("authorization")?.replace(/^Bearer\s+/i, ""),
    values.get("x-goog-api-key"),
  ]) {
    if (value && isAccountReference(value)) return value;
  }
  return null;
}
export async function requestAssistantAccount(
  reference: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!current || current.state.status !== "connected")
    throw new Error("兔子账户未连接，请在兔子助手中重新连接。");
  return current.request(reference, url, init);
}

export const hasAssistantTransport = () => Boolean(current?.requestManual);
/** Explicit host capability: does not enable the old desktop filesystem IPC. */
export function fetchAssistantManual(url: string, init: RequestInit = {}): Promise<Response> {
  return current?.requestManual ? current.requestManual(url, init) : fetch(url, init);
}

/** External sites stay outside the host WebView and receive no model Key. */
export function isAssistantExternalTool(toolId: string): boolean {
  return import.meta.env.VITE_TUZI_ASSISTANT === 'true' &&
    ['chat-mj', 'banana-prompt', 'pose-library'].includes(toolId);
}
export async function openAssistantExternalTool(toolId: string): Promise<void> {
  if (!isAssistantExternalTool(toolId) || !current?.openExternalTool) {
    throw new Error('无法打开系统浏览器，请重试');
  }
  await current.openExternalTool(toolId);
}
