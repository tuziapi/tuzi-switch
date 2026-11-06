import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Tauri replaces the windows array when applying a platform/build override.
// Every shipped/test main window must deliver OS file drops to the HTML canvas.
describe("creative desktop file drop configuration", () => {
  it.each([
    "tauri.conf.json",
    "tauri.windows.conf.json",
    "tauri.acceptance.conf.json",
    "tauri.preview.conf.json",
    "tauri.creative-preview.conf.json",
  ])("%s preserves the canvas file-drop event path", (file) => {
    const config = JSON.parse(
      readFileSync(resolve("src-tauri", file), "utf8"),
    );
    expect(
      config.app.windows.find(
        (window: { label: string }) => window.label === "main",
      ).dragDropEnabled,
    ).toBe(false);
  });
});
