// Synthetic, loopback-only tests. This certificate is never added to OS trust.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuzi-runtime-test-ca-"));
fs.chmodSync(directory, 0o700);
try {
  const config = path.join(directory, "openssl.cnf");
  fs.writeFileSync(config, `[req]
distinguished_name=dn
x509_extensions=extensions
prompt=no
[dn]
CN=Tuzi Synthetic Runtime Test Only
[extensions]
basicConstraints=critical,CA:true
keyUsage=critical,digitalSignature,keyCertSign,cRLSign
extendedKeyUsage=serverAuth
subjectAltName=DNS:claude.ai,DNS:*.claude.ai,DNS:claude.com,DNS:*.claude.com,DNS:anthropic.com,DNS:*.anthropic.com,DNS:localhost,IP:127.0.0.1
`);
  const certificate = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-config", config, "-keyout", path.join(directory, "server.key"),
    "-out", path.join(directory, "server.crt"),
  ], { encoding: "utf8", timeout: 15000 });
  if (certificate.error || certificate.status !== 0) {
    throw new Error(`Cannot generate isolated test certificate: ${certificate.error?.message || certificate.stderr}`);
  }
  fs.chmodSync(path.join(directory, "server.key"), 0o600);
  fs.copyFileSync(path.join(directory, "server.crt"), path.join(directory, "ca.pem"));
  const runtime = "src-tauri/vendor/claude-local/runtime";
  const result = spawnSync(process.env.CLAUDE_LOCAL_TEST_NODE || process.execPath, [
    "--test", `${runtime}/managed.test.mjs`, `${runtime}/proxy.test.mjs`,
    `${runtime}/tuzi-strict.test.mjs`, `${runtime}/scripts/patch-dictation-start.test.mjs`,
    `${runtime}/scripts/patch-dictation-drain.test.mjs`,
  ], {
    cwd: root, stdio: "inherit", timeout: 120000,
    env: { ...process.env, CLAUDE_LOCAL_TEST_CA_DIR: directory },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
