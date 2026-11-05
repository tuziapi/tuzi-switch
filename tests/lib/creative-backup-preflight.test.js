import { describe, expect, it } from "vitest";
import JSZip from "../../packages/creative-workspace/node_modules/jszip";
import { validateBackupPayload } from "../../packages/creative-workspace/upstream/packages/drawnix/src/services/backup-restore/backup-preflight";
import { checksumJson } from "../../packages/creative-workspace/upstream/packages/drawnix/src/services/backup-restore/backup-checksum";
const manifest = () => ({
  includes: { projects: true },
  stats: { boardCount: 1 },
  partIndex: 1,
  totalParts: 1,
});
const archive = () =>
  new JSZip().file(
    "projects/test.drawnix",
    JSON.stringify({ type: "drawnix", elements: [] }),
  );
describe("backup read-only validation before writes", () => {
  it("accepts a complete valid project", async () => {
    await expect(
      validateBackupPayload(archive(), manifest(), "replace"),
    ).resolves.toBeUndefined();
  });
  it("rejects malformed project JSON before clearing", async () => {
    await expect(
      validateBackupPayload(
        archive().file("projects/test.drawnix", "{broken"),
        manifest(),
        "replace",
      ),
    ).rejects.toThrow("损坏");
  });
  it("rejects a missing board", async () => {
    await expect(
      validateBackupPayload(new JSZip(), manifest(), "replace"),
    ).rejects.toThrow("数量不完整");
  });
  it("rejects an invalid board shape", async () => {
    await expect(
      validateBackupPayload(
        archive().file("projects/test.drawnix", "{}"),
        manifest(),
        "replace",
      ),
    ).rejects.toThrow("格式无效");
  });
  it("rejects separately replacing a multipart archive", async () => {
    await expect(
      validateBackupPayload(
        archive(),
        { ...manifest(), totalParts: 2 },
        "replace",
      ),
    ).rejects.toThrow("分片备份");
  });
  it("allows a valid multipart merge", async () => {
    await expect(
      validateBackupPayload(
        archive(),
        { ...manifest(), totalParts: 2 },
        "merge",
      ),
    ).resolves.toBeUndefined();
  });
  it("checks declared checksums and detects valid-JSON tampering", async () => {
    const data = { promptHistory: [] };
    const m = {
      ...manifest(),
      domainStats: {
        prompts: { count: 0, checksum: await checksumJson(data) },
      },
    };
    const zip = archive().file("prompts.json", JSON.stringify(data));
    await expect(
      validateBackupPayload(zip, m, "merge"),
    ).resolves.toBeUndefined();
    zip.file(
      "prompts.json",
      JSON.stringify({ promptHistory: [{ content: "synthetic tamper" }] }),
    );
    await expect(validateBackupPayload(zip, m, "merge")).rejects.toThrow(
      "校验不匹配",
    );
  });
  it("requires a declared data domain", async () => {
    await expect(
      validateBackupPayload(
        archive(),
        { ...manifest(), domainStats: { prompts: { count: 1 } } },
        "replace",
      ),
    ).rejects.toThrow("缺少数据");
  });
  it("rejects sanitized traversal paths", async () => {
    const zip = archive();
    zip.files["projects/test.drawnix"].unsafeOriginalName =
      "../projects/test.drawnix";
    await expect(
      validateBackupPayload(zip, manifest(), "merge"),
    ).rejects.toThrow("不安全路径");
  });
});
