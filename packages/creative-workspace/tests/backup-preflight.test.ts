import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { validateBackupPayload } from "../upstream/packages/drawnix/src/services/backup-restore/backup-preflight";
import type { BackupManifest } from "../upstream/packages/drawnix/src/services/backup-restore/types";

const manifest = {
  includes: { projects: true },
  stats: { boardCount: 1 },
  totalParts: 1,
  partIndex: 1,
} as BackupManifest;
const board = { elements: [], viewport: { zoom: 1 } };

describe("backup checks before store mutations", () => {
  it("accepts a legacy project without embedded media", async () => {
    const zip = new JSZip().file("projects/old.drawnix", JSON.stringify(board));
    await expect(
      validateBackupPayload(zip, manifest, "replace"),
    ).resolves.toBeUndefined();
  });
  it("rejects damaged embedded media before replace recovery can clear existing projects", async () => {
    const zip = new JSZip().file(
      "projects/broken.drawnix",
      JSON.stringify({
        ...board,
        embeddedMedia: [
          {
            url: "/asset-library/a.mp4",
            type: "video",
            mimeType: "video/mp4",
            data: "**broken**",
          },
        ],
      }),
    );
    await expect(
      validateBackupPayload(zip, manifest, "replace"),
    ).rejects.toThrow("媒体");
  });
  it("rejects missing projects and malformed project JSON", async () => {
    await expect(
      validateBackupPayload(new JSZip(), manifest, "replace"),
    ).rejects.toThrow("不完整");
    const zip = new JSZip().file("projects/broken.drawnix", "{broken");
    await expect(
      validateBackupPayload(zip, manifest, "replace"),
    ).rejects.toThrow("损坏");
  });
  it("refuses a partial multipart replacement", async () => {
    await expect(
      validateBackupPayload(
        new JSZip(),
        { ...manifest, totalParts: 2 },
        "replace",
      ),
    ).rejects.toThrow("合并恢复");
  });
});
