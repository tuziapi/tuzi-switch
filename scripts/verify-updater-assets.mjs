import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { verifySignature, targets } from "./updater-assets.mjs";
function fixture(bytes) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = Buffer.from("01234567");
  const pub = Buffer.concat([
    Buffer.from("Ed"),
    id,
    publicKey.export({ type: "spki", format: "der" }).subarray(-32),
  ]);
  const signature = sign(
    null,
    createHash("blake2b512").update(bytes).digest(),
    privateKey,
  );
  const comment = "timestamp:1";
  const global = sign(
    null,
    Buffer.concat([signature, Buffer.from(comment)]),
    privateKey,
  );
  return {
    pub: Buffer.from(
      `untrusted comment: test\n${pub.toString("base64")}\n`,
    ).toString("base64"),
    sig: Buffer.from(
      `untrusted comment: test\n${Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
    ).toString("base64"),
  };
}
test("accepts authentic minisign and rejects modified payload, key and comment", () => {
  const bytes = Buffer.from("synthetic package"),
    f = fixture(bytes);
  verifySignature(bytes, f.sig, f.pub);
  assert.throws(() => verifySignature(Buffer.from("modified"), f.sig, f.pub));
  assert.throws(() => verifySignature(bytes, f.sig, fixture(bytes).pub));
  const altered = Buffer.from(
    Buffer.from(f.sig, "base64")
      .toString()
      .replace("timestamp:1", "timestamp:2"),
  ).toString("base64");
  assert.throws(() => verifySignature(bytes, altered, f.pub));
});
test("covers each native installer without mixing MSI/EXE or DEB/AppImage", () => {
  const all = Object.values(targets).flatMap(Object.entries);
  assert.equal(all.length, 7);
  assert.deepEqual(targets["windows-x64"], {
    "windows-x86_64-nsis": ".exe",
    "windows-x86_64-msi": ".msi",
  });
  assert.equal(targets["linux-x64"]["linux-x86_64-deb"], ".deb");
  assert.equal(targets["linux-x64"]["linux-x86_64-rpm"], ".rpm");
});
