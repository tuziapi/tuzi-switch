import "cross-fetch/polyfill";
import { vi } from "vitest";
import { server } from "./server";

const TAURI_ENDPOINT = "http://tauri.local";

vi.mock("@tauri-apps/api/core", () => ({
  // These HTTP-backed integration tests run in jsdom, without native child views.
  // Native website lifecycle and IPC are exercised by EmbeddedSite and Rust tests.
  isTauri: () => false,
  invoke: async (command: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch(`${TAURI_ENDPOINT}/${command}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Invoke failed for ${command}`);
    }

    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  },
}));

const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

const ensureListenerSet = (event: string) => {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  return listeners.get(event)!;
};

export const emitTauriEvent = (event: string, payload: unknown) => {
  const handlers = listeners.get(event);
  handlers?.forEach((handler) => handler({ payload }));
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    const set = ensureListenerSet(event);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  },
}));

let windowMaximized = false;
const resizeListeners = new Set<() => void>();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => windowMaximized,
    onResized: async (handler: () => void) => {
      resizeListeners.add(handler);
      return () => {
        resizeListeners.delete(handler);
      };
    },
    setDecorations: async () => undefined,
    minimize: async () => undefined,
    toggleMaximize: async () => {
      windowMaximized = !windowMaximized;
      resizeListeners.forEach((handler) => handler());
    },
    close: async () => undefined,
  }),
}));

// Ensure the MSW server is referenced so tree shaking doesn't remove imports
void server;

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: async () => "/home/mock",
  join: async (...segments: string[]) => segments.join("/"),
}));
