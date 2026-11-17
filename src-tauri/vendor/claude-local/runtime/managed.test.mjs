import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { decode, get, asMsg, asStr, ld, vi } from "./rpc.mjs";
import { createOfficialAssets } from "./official-assets.mjs";
import { createStateStore, dropUnroutedModels, gatewayModel, gatewayTarget, modelLabel, modelSelectors, modelWindow, planProfile, runtimeConfig } from "./runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const testCaDir = process.env.CLAUDE_LOCAL_TEST_CA_DIR || path.join(here, "ca");
const modelIds = ["alpha/claude-opus-4-6", "beta/gpt-6", "gamma/grok-4", "alpha/shared", "beta/shared"];
const modelWindows = {
  [modelIds[0]]: 1_000_000, [modelIds[1]]: 1_100_000, [modelIds[2]]: 256_000,
  [modelIds[3]]: 128_000, [modelIds[4]]: 512_000,
};
let root;
let gateway;
let gatewayPort;
let service;
const received = [];

function writeAsar(resourcesDir, members) {
  const tree = { files: {} };
  const bodies = [];
  let offset = 0;
  for (const [member, source] of Object.entries(members)) {
    const body = Buffer.from(source);
    const parts = member.split("/");
    let directory = tree.files;
    for (const part of parts.slice(0, -1)) {
      directory[part] ??= { files: {} };
      directory = directory[part].files;
    }
    directory[parts.at(-1)] = { size: body.length, offset: String(offset) };
    bodies.push(body);
    offset += body.length;
  }
  const json = Buffer.from(JSON.stringify(tree));
  const paddedJsonSize = Math.ceil(json.length / 4) * 4;
  const headerSize = 8 + paddedJsonSize;
  const payloadStart = 8 + headerSize;
  const prefix = Buffer.alloc(payloadStart);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(4 + paddedJsonSize, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, "ion-dist.asar"), Buffer.concat([prefix, ...bodies]));
}

async function request(instance, pathname, { host, body, type = "application/json", method = body === undefined ? "GET" : "POST", extraHeaders = {}, auth = true, onChunk } = {}) {
  const raw = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = {
    ...(raw ? { "content-type": type, "content-length": raw.length } : {}),
    ...(!host && auth && pathname !== "/__codex_claude_local/health" ? { authorization: "Bearer test-local-gateway-token" } : {}),
    ...extraHeaders,
  };
  let agent;
  if (host) {
    const connect = http.request({ host: "127.0.0.1", port: instance.port, method: "CONNECT", path: `${host}:443` });
    connect.end();
    const [response, socket] = await once(connect, "connect");
    assert.equal(response.statusCode, 200);
    const secure = tls.connect({ socket, servername: host, ca: fs.readFileSync(path.join(testCaDir, "ca.pem")) });
    await once(secure, "secureConnect");
    agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => secure;
  }
  try {
    return await new Promise((resolve, reject) => {
      const req = (host ? https : http).request({
        hostname: host || "127.0.0.1", port: host ? 443 : instance.port,
        path: pathname, method, headers, ...(agent ? { agent } : {}),
      }, (res) => {
        const chunks = [];
        res.on("error", reject);
        res.on("data", (chunk) => { chunks.push(chunk); onChunk?.(chunk, res); });
        res.on("end", () => {
          const bytes = Buffer.concat(chunks);
          resolve({
            status: res.statusCode, bytes,
            headers: res.headers,
            json: String(res.headers["content-type"]).includes("json") ? JSON.parse(bytes.toString("utf8")) : null,
          });
        });
      });
      req.on("error", (error) => reject(new Error(`${method} ${pathname}: ${error.message}\n${service?.output?.() ?? ""}`)));
      if (onChunk) req.setTimeout(3000, () => req.destroy(new Error("stream made no progress")));
      req.end(raw);
    });
  } finally {
    agent?.destroy();
  }
}

async function start(extra = {}, runtimeDir = path.join(root, "runtime")) {
  const ready = path.join(root, "ready.json");
  const instanceId = `managed-test-${Date.now()}`;
  const child = spawn(process.execPath, [path.join(runtimeDir, "proxy.mjs"), "--port", "0", "--mode", "mock", "--log", "0", "--ca", testCaDir], {
    env: {
      ...process.env,
      CLAUDE_LOCAL_MANAGED: "1",
      CLAUDE_LOCAL_DESKTOP_RESOURCES: path.join(root, "desktop-resources"),
      CLAUDE_LOCAL_READY_FILE: ready,
      CLAUDE_LOCAL_INSTANCE_ID: instanceId,
      CLAUDE_LOCAL_STATE_FILE: path.join(root, "state.json"),
      CLAUDE_LOCAL_CACHE_DIR: path.join(root, "cache"),
      CLAUDE_LOCAL_WEB_I18N_DIR: path.join(root, "catalogs"),
      CLAUDE_LOCAL_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}/gw/desktop`,
      CLAUDE_LOCAL_GATEWAY_KEY: "test-local-gateway-token",
      CLAUDE_LOCAL_GATEWAY_MODEL: modelIds[0],
      CLAUDE_LOCAL_GATEWAY_MODELS: JSON.stringify(modelIds),
      CLAUDE_LOCAL_GATEWAY_MODEL_WINDOWS: JSON.stringify(modelWindows),
      CLAUDE_LOCAL_LOCALIZATION: "1",
      CLAUDE_LOCAL_VOICE_INPUT: "0",
      CLAUDE_LOCAL_COMPUTER_USE: "0",
      CLAUDE_LOCAL_BACKGROUND_MODE: "0",
      ...extra,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const closed = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
  for (let count = 0; count < 500; count++) {
    if (child.exitCode !== null) throw new Error(`Managed fixture exited: ${output}`);
    try {
      const receipt = JSON.parse(fs.readFileSync(ready, "utf8"));
      if (receipt.instanceId === instanceId) {
        assert.equal(receipt.pid, child.pid);
        assert.ok(receipt.port > 0);
        return { ...receipt, child, closed, output: () => output };
      }
    } catch {}
    await delay(10);
  }
  child.kill("SIGTERM");
  await closed;
  throw new Error(`Managed fixture did not become ready: ${output}`);
}

async function stop(instance, signal = false) {
  if (!instance || instance.child.exitCode !== null) return;
  if (signal) instance.child.kill("SIGTERM");
  else instance.child.stdin.end();
  const result = await Promise.race([instance.closed, delay(5000).then(() => { throw new Error("Managed fixture did not exit"); })]);
  // Windows SIGTERM is forced termination; graceful persistence is exercised
  // separately by stdin closure. The subsequent request must fail on all OSes.
  if (!(signal && process.platform === "win32")) assert.equal(result[0], 0);
}

const header = (conv) => ld(1, Buffer.concat([ld(1, Buffer.concat([ld(1, "test-session"), vi(2, 1)])), ld(2, conv)]));
const send = (conv, prompt, model) => Buffer.concat([
  header(conv),
  ld(2, Buffer.concat([
    ld(1, `user-${crypto.randomUUID()}`), ld(2, `assistant-${crypto.randomUUID()}`), ld(3, prompt),
    ...(model ? [ld(7, ld(2, model))] : []),
  ])),
]);

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-managed-"));
  writeAsar(path.join(root, "desktop-resources"), {
    "index.html": '<!doctype html><html data-build-id="fixture-build"><head><meta charset="UTF-8"><link rel="preload" href="/assets/v1/main.js"><script>window.fixtureAppStarted = true;</script><script type="module" src="/assets/v1/main.js"></script></head><body><div id="root"></div></body></html>',
    "assets/v1/main.js": "export const localOfficialAsset = true;",
    "i18n/en-US.json": JSON.stringify({ greeting: "Hello" }),
    "i18n/dynamic/en-US.json": JSON.stringify({ dynamic: "Hello" }),
    "images/icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    "audio/tone.mp3": Buffer.from([0x49, 0x44, 0x33]),
  });
  fs.mkdirSync(path.join(root, "runtime", "scripts"), { recursive: true });
  for (const file of ["proxy.mjs", "conversation-service.mjs", "rpc.mjs", "runtime.mjs", "official-assets.mjs", "scripts/patch-dictation-start.mjs"]) {
    fs.copyFileSync(path.join(here, file), path.join(root, "runtime", file));
  }
  fs.copyFileSync(
    path.join(here, "../assets/localization/page-shim.js"),
    path.join(root, "runtime", "page-shim.js"),
  );
  fs.mkdirSync(path.join(root, "runtime", "mock", "api"), { recursive: true });
  fs.writeFileSync(path.join(root, "runtime", "mock", "bootstrap.json"), JSON.stringify({ privateFixture: "must-not-leak" }));
  fs.writeFileSync(path.join(root, "runtime", "mock", "api", "account_profile.json"), JSON.stringify({ privateFixture: "must-not-leak" }));
  fs.mkdirSync(path.join(root, "catalogs"), { recursive: true });
  fs.writeFileSync(path.join(root, "catalogs", "zh-Hans.json"), JSON.stringify({ message: "translated" }));
  fs.mkdirSync(path.join(root, "cache"), { recursive: true });
  fs.writeFileSync(path.join(root, "cache", "private-recorded.json"), JSON.stringify({ url: "claude.ai/edge-api/bootstrap", status: 200 }));
  fs.writeFileSync(path.join(root, "cache", "private-recorded"), JSON.stringify({ privateFixture: "must-not-leak" }));
  const oldLoginKey = crypto.createHash("sha1").update("claude.ai/login").digest("hex");
  fs.writeFileSync(path.join(root, "cache", oldLoginKey), "<html>stale private login shell</html>");
  fs.writeFileSync(path.join(root, "cache", `${oldLoginKey}.json`), JSON.stringify({ status: 200, headers: { "content-type": "text/html" }, url: "claude.ai/login" }));
  gateway = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    received.push({ path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"gateway reply"}}\n\ndata: {"type":"message_stop"}\n\n');
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  gatewayPort = gateway.address().port;
  service = await start();
});

after(async () => {
  await stop(service);
  gateway?.closeAllConnections();
  await new Promise((resolve) => gateway?.close(resolve));
});

test("managed readiness reports an assigned port and health polling is not client traffic", async () => {
  const first = await request(service, "/__codex_claude_local/health");
  const second = await request(service, "/__codex_claude_local/health");
  assert.equal(first.json.instanceId, service.instanceId);
  assert.equal(first.json.pid, service.child.pid);
  assert.equal(first.json.port, service.port);
  assert.equal(first.json.lastClientAt, null);
  assert.equal(second.json.lastClientAt, null);
  assert.equal(Object.hasOwn(first.json, "token"), false);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(root, "ready.json")).mode & 0o777, 0o600);
  }
  await request(service, "/api/bootstrap", { host: "claude.ai" });
  const active = await request(service, "/__codex_claude_local/health");
  assert.equal(typeof active.json.lastClientAt, "string");
});

test("fresh managed profile serves the installed official shell and bounded ASAR resources", async () => {
  const resources = createOfficialAssets(path.join(root, "desktop-resources"));
  assert.equal(resources.buildId, "fixture-build");
  assert.deepEqual(resources.i18nLocales, ["en-US"]);
  assert.equal(resources.read("/assets/%2e%2e%2fi18n/s/zh-Hans.json"), null);
  assert.equal(resources.read("/assets%2fv1/main.js"), null);
  resources.close();

  const shell = await request(service, "/new", { host: "claude.ai" });
  assert.equal(shell.status, 200);
  const shellHtml = shell.bytes.toString("utf8");
  assert.match(shellHtml, /data-build-id="fixture-build"/);
  assert.doesNotMatch(shellHtml, /stale private login shell/);
  // Desktop parses exactly locale:baseRevision.dynamicRevision. A third
  // revision component silently excludes the locale and falls back to English.
  const advertisedCatalogs = shellHtml.match(/data-i18n-catalogs="([^"]+)"/)[1]
    .split(',').map(value => /^([\w-]+):([\w-]+)\.([\w-]+)$/.exec(value))
    .filter(Boolean).map(match => match[1]);
  assert.deepEqual(advertisedCatalogs, ['en-US', 'zh-Hans']);
  const shimIndex = shellHtml.indexOf('<script src="/__codex_plus/claude-localization.js"></script>');
  const firstAppScript = shellHtml.indexOf("<script>");
  assert.ok(shellHtml.indexOf('name="i18n-catalogs"') < firstAppScript);
  assert.ok(shimIndex > shellHtml.indexOf('<meta charset="UTF-8">'));
  assert.ok(shimIndex < firstAppScript);
  assert.equal(shell.headers["content-security-policy"], undefined);

  const shim = await request(service, "/__codex_plus/claude-localization.js", { host: "claude.ai" });
  assert.equal(shim.status, 200);
  assert.equal(shim.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(shim.headers["x-content-type-options"], "nosniff");
  assert.equal(shim.headers["cache-control"], "no-store");
  assert.deepEqual(shim.bytes, fs.readFileSync(path.join(root, "runtime", "page-shim.js")));
  assert.match(shim.bytes.toString("utf8"), /spa:locale/);
  assert.equal((await request(service, "/__codex_plus/claude-localization.js", {
    host: "claude.ai", method: "HEAD",
  })).status, 200);
  assert.equal((await request(service, "/__codex_plus/other.js", { host: "claude.ai" })).status, 404);
  assert.equal((await request(service, "/__codex_plus/claude-localization.js", {
    host: "claude.ai", method: "POST", body: {},
  })).status, 404);

  const route = await request(service, "/settings/general", { host: "claude.ai" });
  assert.equal(route.status, 200);
  const routeHtml = route.bytes.toString("utf8");
  assert.match(routeHtml, /data-build-id="fixture-build"/);
  assert.equal([...routeHtml.matchAll(/<script src="\/__codex_plus\/claude-localization\.js"><\/script>/g)].length, 1);

  for (const [host, pathname] of [
    ["claude.ai", "/i18n/zh-Hans.json?v=1.1"],
    ["claude.ai", "/i18n/dynamic/zh-Hans.json?v=1.1"],
    ["assets-proxy.anthropic.com", "/claude-ai/v2/i18n/zh-Hans.json?v=1.1"],
    ["assets-proxy.anthropic.com", "/claude-ai/v2/i18n/dynamic/zh-Hans.json?v=1.1"],
  ]) {
    const catalog = await request(service, pathname, { host });
    assert.equal(catalog.status, 200, `${host}${pathname}: ${catalog.bytes.toString("utf8").slice(0, 160)}`);
    assert.deepEqual(catalog.json, host === "claude.ai" && pathname.includes("/dynamic/")
      || host === "assets-proxy.anthropic.com" && pathname.includes("/dynamic/")
      ? {}
      : { message: "translated" });
    assert.equal(host === "assets-proxy.anthropic.com" ? catalog.headers["access-control-allow-origin"] : undefined,
      host === "assets-proxy.anthropic.com" ? "*" : undefined);
  }

  const asset = await request(service, "/assets/v1/main.js", { host: "claude.ai" });
  assert.equal(asset.status, 200);
  assert.equal(asset.bytes.toString("utf8"), "export const localOfficialAsset = true;");
  assert.match(asset.bytes.toString("utf8"), /localOfficialAsset/);
  const cdnAsset = await request(service, "/claude-ai/v2/assets/v1/main.js", { host: "assets-proxy.anthropic.com" });
  assert.equal(cdnAsset.status, 200);
  assert.equal(cdnAsset.bytes.toString("utf8"), asset.bytes.toString("utf8"));
  const missing = await request(service, "/assets/v1/missing.js", { host: "claude.ai" });
  assert.equal(missing.status, 404);

  const bootstrap = await request(service, "/api/bootstrap", { host: "claude.ai" });
  assert.equal(bootstrap.json.gated_imports_build_id, "fixture-build");
});

test("localization overrides and numeric regions cannot crash the runtime", async () => {
  for (const host of ["claude.ai", "assets-proxy.anthropic.com"]) {
    const prefix = host === "claude.ai" ? "" : "/claude-ai/v2";
    for (const locale of ["zh-Hans", "es-419"]) {
      const overrides = await request(service, `${prefix}/i18n/${locale}.overrides.json?v=1`, { host });
      assert.equal(overrides.status, 200);
      assert.deepEqual(overrides.json, {});
      const base = await request(service, `${prefix}/i18n/${locale}.json`, { host });
      assert.equal(base.status, 200);
      assert.deepEqual(base.json, { message: "translated" });
    }
    assert.equal((await request(service, `${prefix}/i18n/unknown.resource`, { host })).status, 404);
  }
  assert.equal((await request(service, "/__codex_claude_local/health")).status, 200);
});

test("isolated template uses installed shell and CDN assets without outbound web requests", async () => {
  const runtimeDir = path.join(root, "isolated-template-runtime");
  fs.cpSync(path.join(root, "runtime"), runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "mock", ".codex-plus-template"), "");
  let outbound = 0;
  const upstream = http.createServer();
  upstream.on("connect", (_req, socket) => {
    outbound++;
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  let instance;
  try {
    instance = await start({
      CLAUDE_LOCAL_STRICT_MODELS: "1",
      CLAUDE_LOCAL_UPSTREAM_PROXY: `http://127.0.0.1:${upstream.address().port}`,
    }, runtimeDir);
    const shell = await request(instance, "/new", { host: "claude.ai" });
    assert.equal(shell.status, 200);
    assert.match(shell.bytes.toString(), /data-build-id="fixture-build"/);
    assert.match(shell.bytes.toString(), /claude-localization\.js/);
    for (const [host, pathname] of [
      ["claude.ai", "/assets/v1/main.js"],
      ["assets-proxy.anthropic.com", "/claude-ai/v2/assets/v1/main.js"],
    ]) {
      const asset = await request(instance, pathname, { host });
      assert.equal(asset.status, 200);
      assert.equal(asset.bytes.toString(), "export const localOfficialAsset = true;");
    }
    for (const host of ["api.anthropic.com", "claude.ai"]) {
      const update = await request(instance, "/api/desktop/darwin/arm64/squirrel/update?version=5.11492.5", { host });
      assert.equal(update.status, 204);
      assert.equal(update.bytes.length, 0);
    }
    assert.equal(outbound, 0);
  } finally {
    await stop(instance);
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test("Code bundle streams before completion and cancellation closes its upstream", async () => {
  let source;
  let sourceClosed;
  const upstream = http.createServer((_req, res) => {
    source = res;
    sourceClosed = once(res, "close");
    res.writeHead(200, { "content-type": "application/zstd", "content-length": 6 });
    res.write("abc");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  let instance;
  try {
    instance = await start({
      CLAUDE_LOCAL_UPSTREAM_MAP: JSON.stringify({ "downloads.claude.ai": `http://127.0.0.1:${upstream.address().port}` }),
    });
    let chunks = 0;
    const result = await request(instance, "/claude-code-releases/fixture/claude.app.tar.zst", {
      host: "downloads.claude.ai",
      onChunk: () => { if (++chunks === 1) source.end("def"); },
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-length"], "6");
    assert.equal(result.bytes.toString(), "abcdef");
    await assert.rejects(request(instance, "/claude-code-releases/fixture/cancel.tar.zst", {
      host: "downloads.claude.ai", onChunk: (_chunk, res) => res.destroy(new Error("test cancellation")),
    }), /test cancellation/);
    await Promise.race([sourceClosed, delay(2000).then(() => { throw new Error("upstream not cancelled"); })]);
    assert.equal((await request(instance, "/__codex_claude_local/health")).status, 200);
  } finally {
    await stop(instance);
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test("installed template fetches the first shell through the configured upstream proxy, then replays it", async () => {
  // 后端 install_assets 会写入内嵌模板（mock/.codex-plus-template）：模板数据配线上外壳写穿缓存。
  // 受限地区直连 claude.ai 会被 302，首次抓外壳要经后端传入的出站代理（CONNECT 隧道）。
  const connects = [];
  const upstreamProxy = http.createServer();
  upstreamProxy.on("connect", (req, socket) => {
    connects.push(req.url);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  upstreamProxy.listen(0, "127.0.0.1");
  await once(upstreamProxy, "listening");
  upstreamProxy.unref();
  const runtimeDir = path.join(root, "template-runtime");
  fs.cpSync(path.join(root, "runtime"), runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "mock", ".codex-plus-template"), "");
  const env = {
    CLAUDE_LOCAL_CACHE_DIR: path.join(runtimeDir, ".cache"),
    CLAUDE_LOCAL_UPSTREAM_PROXY: `http://127.0.0.1:${upstreamProxy.address().port}`,
  };
  const fresh = await start(env, runtimeDir);
  try {
    const shell = await request(fresh, "/settings/general", { host: "claude.ai" });
    assert.notEqual(shell.status, 200, "代理拒绝时不能假装拿到了外壳");
    assert.deepEqual(connects, ["claude.ai:443"], "首次外壳经出站代理去 claude.ai");
  } finally {
    await stop(fresh);
  }

  // 录制（或已写穿）的外壳在场时直接回放，不再联网。
  connects.length = 0;
  const shellKey = crypto.createHash("sha1").update("claude.ai/epitaxy").digest("hex");
  fs.mkdirSync(path.join(runtimeDir, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, ".cache", shellKey), `<html data-build-id="recorded">${"x".repeat(5000)}</html>`);
  fs.writeFileSync(path.join(runtimeDir, ".cache", `${shellKey}.json`), JSON.stringify({ status: 200, headers: { "content-type": "text/html" }, url: "claude.ai/epitaxy" }));
  const recorded = await start(env, runtimeDir);
  try {
    const shell = await request(recorded, "/settings/general", { host: "claude.ai" });
    assert.equal(shell.status, 200);
    assert.match(shell.bytes.toString("utf8"), /data-build-id="recorded"/);
    assert.deepEqual(connects, []);
  } finally {
    await stop(recorded);
    upstreamProxy.close();
  }
});

test("unpacked ion-dist directory is served when the Claude build ships no ASAR", async () => {
  // 部分 Claude 版本把前端解包成 resources/ion-dist/，没有 ion-dist.asar（issue #5）。
  const resourcesDir = path.join(root, "unpacked-resources");
  const dist = path.join(resourcesDir, "ion-dist");
  fs.mkdirSync(path.join(dist, "assets", "v1"), { recursive: true });
  fs.mkdirSync(path.join(dist, "i18n", "dynamic"), { recursive: true });
  fs.mkdirSync(path.join(dist, "private"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><html data-build-id="unpacked-build"><head></head><body></body></html>');
  fs.writeFileSync(path.join(dist, "assets", "v1", "main.js"), "export const unpacked = true;");
  fs.writeFileSync(path.join(dist, "i18n", "en-US.json"), "{}");
  fs.writeFileSync(path.join(dist, "i18n", "dynamic", "en-US.json"), "{}");
  fs.writeFileSync(path.join(dist, "secret.txt"), "must-not-leak");
  fs.writeFileSync(path.join(dist, "private", "x.js"), "must-not-leak");
  let linked = false;
  try {
    fs.symlinkSync(path.join(dist, "secret.txt"), path.join(dist, "assets", "v1", "link.js"));
    linked = true;
  } catch { /* Windows 无权限建符号链接时跳过这一项 */ }

  const resources = createOfficialAssets(resourcesDir);
  try {
    assert.equal(resources.buildId, "unpacked-build");
    assert.deepEqual(resources.i18nLocales, ["en-US"]);
    assert.equal(resources.archivePath, fs.realpathSync(dist));
    const asset = resources.read("/assets/v1/main.js");
    assert.equal(asset.body.toString("utf8"), "export const unpacked = true;");
    assert.equal(asset.contentType, "text/javascript; charset=utf-8");
    assert.equal(resources.read("/index.html").isHtml, true);
    assert.equal(resources.read("/secret.txt"), null);
    assert.equal(resources.read("/private/x.js"), null);
    assert.equal(resources.read("/assets/%2e%2e%2fsecret.txt"), null);
    assert.equal(resources.read("/assets/../secret.txt"), null);
    if (linked) assert.equal(resources.read("/assets/v1/link.js"), null);
    // 运行中被删掉的文件按缺失处理，不抛错。
    fs.rmSync(path.join(dist, "assets", "v1", "main.js"));
    assert.equal(resources.read("/assets/v1/main.js"), null);
  } finally {
    resources.close();
  }

  // asar 与目录都在时以 asar 为准；两者都没有时报出清楚的错误。
  const both = path.join(root, "both-resources");
  fs.cpSync(resourcesDir, both, { recursive: true, verbatimSymlinks: true });
  fs.copyFileSync(path.join(root, "desktop-resources", "ion-dist.asar"), path.join(both, "ion-dist.asar"));
  const preferred = createOfficialAssets(both);
  assert.equal(preferred.buildId, "fixture-build");
  preferred.close();
  const empty = path.join(root, "empty-resources");
  fs.mkdirSync(empty, { recursive: true });
  assert.throws(() => createOfficialAssets(empty), /neither ion-dist\.asar nor ion-dist/);

  // 整个托管代理用解包目录也能起来，并回官方外壳。
  fs.writeFileSync(path.join(dist, "assets", "v1", "main.js"), "export const unpacked = true;");
  const instance = await start({ CLAUDE_LOCAL_DESKTOP_RESOURCES: resourcesDir });
  try {
    const shell = await request(instance, "/new", { host: "claude.ai" });
    assert.equal(shell.status, 200);
    assert.match(shell.bytes.toString("utf8"), /data-build-id="unpacked-build"/);
    const asset = await request(instance, "/assets/v1/main.js", { host: "claude.ai" });
    assert.equal(asset.bytes.toString("utf8"), "export const unpacked = true;");
  } finally {
    await stop(instance);
  }
});

test("installed template turns on the Cowork GrowthBook gate unless disabled", async () => {
  // 录制模板里 yukon_silver（574905726）是 false，新版 Claude 只显示 Chat / Code（issue #4）。
  const runtimeDir = path.join(root, "cowork-runtime");
  fs.cpSync(path.join(root, "runtime"), runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "mock", ".codex-plus-template"), "");
  fs.writeFileSync(path.join(runtimeDir, "mock", "bootstrap.json"), JSON.stringify({
    org_growthbook: {
      hashing_algorithm: "djb2",
      features: { "574905726": { defaultValue: false }, "577907085": { defaultValue: true } },
    },
  }));
  const env = { CLAUDE_LOCAL_CACHE_DIR: path.join(runtimeDir, ".cache") };
  const features = async (extra) => {
    const instance = await start({ ...env, ...extra }, runtimeDir);
    try {
      return (await request(instance, "/edge-api/bootstrap", { host: "claude.ai" })).json.org_growthbook;
    } finally {
      await stop(instance);
    }
  };
  const on = await features({});
  assert.deepEqual(on.features["574905726"], { defaultValue: true });
  assert.deepEqual(on.features["577907085"], { defaultValue: true }, "其它功能保持模板原值");
  assert.equal(on.hashing_algorithm, "djb2");
  const off = await features({ CLAUDE_LOCAL_COWORK: "0" });
  assert.deepEqual(off.features["574905726"], { defaultValue: false });
});

test("strict P0 does not advertise disabled Cowork capability", async () => {
  const instance = await start({ CLAUDE_LOCAL_STRICT_MODELS: "1", CLAUDE_LOCAL_COWORK: "0" });
  try {
    const boot = (await request(instance, "/edge-api/bootstrap", { host: "claude.ai" })).json;
    assert.equal(boot.feature_flags.cowork, false);
    assert.ok(!boot.account.capabilities.includes("cowork"));
    assert.ok(!boot.organization.capabilities.includes("cowork"));
  } finally { await stop(instance); }
});

test("strict P0 exposes explicitly enabled capabilities without enabling background access", async () => {
  const instance = await start({
    CLAUDE_LOCAL_STRICT_MODELS: "1", CLAUDE_LOCAL_COWORK: "1",
    CLAUDE_LOCAL_COMPUTER_USE: "1", CLAUDE_LOCAL_BACKGROUND_MODE: "0",
  });
  try {
    const boot = (await request(instance, "/edge-api/bootstrap", { host: "claude.ai" })).json;
    assert.ok(boot.account.capabilities.includes("cowork"));
    assert.ok(boot.account.capabilities.includes("computer_use"));
    assert.equal(boot.account.settings.dramatic_shrimp_enabled, false, "managed Cowork uses the native local executor instead of an unavailable cloud worker");
    assert.equal(boot.user.settings.dramatic_shrimp_enabled, false);
    const profile = (await request(instance, "/api/account_profile", { host: "claude.ai" })).json;
    assert.equal(profile.account.settings.dramatic_shrimp_enabled, false, "profile refresh must preserve the local routing preference");
    assert.ok(boot.system_prompts.cowork_system_prompt.value.prompt.trim().length > 0);
    const prompts = await request(instance, `/api/bootstrap/${boot.organization.uuid}/system_prompts`, { host: "claude.ai" });
    assert.deepEqual(prompts.json, boot.system_prompts);
    const desktop = (await request(instance, "/api/desktop/features", { host: "claude.ai" })).json;
    assert.deepEqual(desktop.features["1291166712"].value, { enabled: true, appScopedEnabled: false });
  } finally { await stop(instance); }
});

test("strict managed cloud session creation fails explicitly without invoking the gateway", async () => {
  const instance = await start({ CLAUDE_LOCAL_STRICT_MODELS: "1", CLAUDE_LOCAL_COWORK: "1" });
  try {
    const before = received.length;
    for (const host of ["claude.ai", "api.anthropic.com"]) {
      for (const pathname of ["/v1/code/sessions", "/api/organizations/test-org/cowork/sessions/"]) {
        const result = await request(instance, pathname, {
          host, body: { message: "synthetic-private-prompt" },
          extraHeaders: { accept: "text/event-stream, application/json" },
        });
        assert.equal(result.status, 501, `${host}${pathname} must not return an empty success or SSE stream`);
        assert.equal(result.json.error.type, "not_supported_error");
        assert.equal(result.json.error.reason, "local_executor_required");
        assert.match(result.json.error.message, /Cowork/);
        assert.ok(!result.bytes.includes(Buffer.from("synthetic-private-prompt")));
        assert.equal(result.json.session, undefined);
        assert.equal(result.json.session_id, undefined);
      }
    }
    assert.equal(received.length, before, "unsupported creation cannot send a model request");
    for (const host of ["claude.ai", "api.anthropic.com"]) {
      const list = await request(instance, "/v1/code/sessions/?limit=20", { host });
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.sessions, [], "hosted discovery stays local and does not invent sessions");
    }
  } finally { await stop(instance); }
});

test("clean managed runtime uses synthetic bootstrap and configured catalogs without private recordings", async () => {
  for (const pathname of ["/edge-api/bootstrap", "/api/bootstrap", "/api/bootstrap/local/app_start"]) {
    const result = await request(service, pathname, { host: "claude.ai" });
    assert.equal(result.status, 200);
    assert.equal(result.json.privateFixture, undefined);
    assert.equal(result.json.account.email_address, "local@claude.local");
    assert.equal(result.json.locale, "zh-Hans");
    assert.deepEqual(result.json.gated_imports, {});
    assert.deepEqual(result.json.current_user_access.features, []);
    assert.equal(result.json.activeOrganization.uuid, result.json.resolved_org_uuid);
    assert.equal(result.json.activeOrganization.uuid, result.json.account.organization_uuid);
    assert.equal(result.json.account.memberships[0].organization.uuid, result.json.activeOrganization.uuid);
    assert.equal(result.json.account.memberships[0].status, "active");
    assert.equal(result.json.account.memberships[0].organization.capabilities.includes("chat"), true);
    assert.equal(result.json.account.workspace_memberships.length, 1);
    assert.equal(result.json.user.memberships[0].organization.uuid, result.json.activeOrganization.uuid);
    assert.ok(result.headers["set-cookie"].some((cookie) => cookie.startsWith(`lastActiveOrg=${result.json.activeOrganization.uuid};`)));
    assert.deepEqual(result.json.model_selector_config.find((entry) => entry.id === "chat").models.map((model) => model.id), modelIds);
    assert.ok(result.json.model_selector_config[0].models.every((model) => model.capabilities.mm_images === false));
  }
  const profile = await request(service, "/api/account_profile", { host: "claude.ai" });
  assert.equal(profile.json.privateFixture, undefined);
  assert.equal(profile.json.conversation_preferences, null);
  assert.equal(profile.json.display_name, "Local User");
  assert.equal(profile.json.full_name, "Local User");
  assert.equal(profile.json.organization_uuid, "e0e877d3-8475-44a1-a501-4fc431b085ab");
  assert.equal(profile.json.membership.organization.uuid, profile.json.organization_uuid);
  assert.ok(profile.headers["set-cookie"].some((cookie) => cookie.startsWith(`lastActiveOrg=${profile.json.organization_uuid};`)));
  const catalog = await request(service, "/i18n/s/zh-Hans.json", { host: "claude.ai" });
  assert.deepEqual(catalog.json, { message: "translated" });
  const chromeLocaleCatalog = await request(service, "/i18n/s/zh-CN.json", { host: "claude.ai" });
  assert.deepEqual(chromeLocaleCatalog.json, { message: "translated" });
  const defaultLocaleCatalog = await request(service, "/i18n/s/en-US.json", { host: "claude.ai" });
  assert.deepEqual(defaultLocaleCatalog.json, { message: "translated" });
});

test("organization detail never resets the active-org cookie (Desktop re-checks the allowlist on every change)", async () => {
  // Desktop 主进程监听 lastActiveOrg cookie，一变就请求 /api/organizations/<id> 查插件白名单；
  // 这个接口再下发 cookie 就是死循环（实测 1600+ 次/秒，主进程卡死、窗口点不动）。
  const detail = await request(service, "/api/organizations/e0e877d3-8475-44a1-a501-4fc431b085ab", { host: "claude.ai" });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.uuid, "e0e877d3-8475-44a1-a501-4fc431b085ab");
  assert.equal(detail.headers["set-cookie"], undefined);
  // 活动组织仍由 bootstrap 入口设置。
  const bootstrap = await request(service, "/api/bootstrap", { host: "claude.ai" });
  assert.ok(String(bootstrap.headers["set-cookie"]).includes("lastActiveOrg="));
});

test("managed organization discovery stays on the already joined local organization", async () => {
  const discoverable = await request(service, "/api/organizations/discoverable", { host: "claude.ai" });
  assert.equal(discoverable.status, 200);
  assert.deepEqual(discoverable.json.organizations, []);
  assert.deepEqual(discoverable.json.data, []);
  assert.deepEqual(discoverable.json.items, []);
  assert.ok(discoverable.headers["set-cookie"].some((cookie) => cookie.startsWith("lastActiveOrg=e0e877d3-8475-44a1-a501-4fc431b085ab;")));

  const joined = await request(service, "/api/organizations/e0e877d3-8475-44a1-a501-4fc431b085ab/join", {
    host: "claude.ai", method: "POST", body: {},
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.json.joined, true);
  assert.equal(joined.json.is_member, true);
  assert.equal(joined.json.membership.organization.uuid, "e0e877d3-8475-44a1-a501-4fc431b085ab");
  assert.equal(joined.json.membership.status, "active");
});

test("managed feature flags are independently reflected without granting system permissions", async () => {
  const result = await request(service, "/api/desktop/features", { host: "claude.ai" });
  assert.deepEqual(result.json.features["1291166712"].value, { enabled: false, appScopedEnabled: false });
  assert.equal(result.json.chicagoEnabled, undefined);
  const bootstrap = await request(service, "/api/bootstrap", { host: "claude.ai" });
  assert.equal(bootstrap.json.feature_flags.computer_use, false);
  assert.equal(bootstrap.json.account.capabilities.includes("computer_use"), false);
});

test("managed usage returns the frontend limits contract without invented subscription usage", async () => {
  const usage = await request(service, "/api/organizations/local/usage?skip_spend=1", { host: "claude.ai" });
  assert.equal(usage.status, 200);
  assert.deepEqual(usage.json.limits, []);
  assert.equal(usage.json.five_hour, null);
  assert.equal(usage.json.extra_usage.used_credits, null);
  assert.equal(usage.json.windows, undefined);
  const bootstrap = await request(service, "/edge-api/bootstrap", { host: "claude.ai" });
  assert.equal(bootstrap.json.served_copy["web.plan_name.max_20x"], "Codex++ 本地网关");
});

test("managed model selector responses include per-model runtime windows", async () => {
  for (const host of ["claude.ai", "api.anthropic.com"]) {
    for (const surface of ["cc", "ccd", "ccr"]) {
      for (const prefix of ["/api", "/api/organizations/local"]) {
        const result = await request(service, `${prefix}/model_selector/${surface}`, { host });
        assert.equal(result.status, 200);
        const [config] = result.json.model_selector_config;
        assert.equal(config.id, surface);
        assert.deepEqual(config.models.map((entry) => [entry.id, entry.context_window]), Object.entries(modelWindows));
        assert.deepEqual(config.models.map((entry) => [entry.id, entry.runtime.max_input_tokens]), Object.entries(modelWindows));
      }
    }
  }
});

test("model window metadata validates configured values", () => {
  const config = runtimeConfig({
    CLAUDE_LOCAL_MANAGED: "1",
    CLAUDE_LOCAL_GATEWAY_URL: "https://localhost/gw/test/",
    CLAUDE_LOCAL_GATEWAY_MODEL: "alpha/claude-opus-4-6",
    CLAUDE_LOCAL_GATEWAY_KEY: "test",
    CLAUDE_LOCAL_GATEWAY_MODEL_WINDOWS: JSON.stringify({ "alpha/claude-opus-4-6": 1_000_000 }),
  });
  assert.equal(modelWindow(config, "alpha/claude-opus-4-6"), 1_000_000);
  assert.equal(modelWindow(config, "unknown"), 200_000);
  assert.equal(modelWindow(config, "ALPHA/claude-opus-4-6"), 1_000_000);
  assert.equal(modelWindow(config, "claude-opus-4-6"), 1_000_000, "裸模型名也能命中带前缀的声明");
  for (const value of ["[]", '{"m":0}', '{"m":-1}', '{"m":"1100000"}', '{"m":1.1}']) {
    assert.throws(() => runtimeConfig({ CLAUDE_LOCAL_GATEWAY_MODEL_WINDOWS: value }), /model windows/);
  }
});

test("selected model falls back to the gateway default window instead of 200k", () => {
  const config = runtimeConfig({
    CLAUDE_LOCAL_MANAGED: "1",
    CLAUDE_LOCAL_GATEWAY_URL: "https://localhost/gw/test/",
    CLAUDE_LOCAL_GATEWAY_MODEL: "jojocodemax/gpt-6.1-sol",
    CLAUDE_LOCAL_GATEWAY_KEY: "test",
    CLAUDE_LOCAL_GATEWAY_MODELS: JSON.stringify(["jojocodemax/gpt-6.1-sol", "chatgpt/gpt-6.1-terra"]),
    CLAUDE_LOCAL_GATEWAY_MODEL_WINDOWS: JSON.stringify({}),
    CLAUDE_LOCAL_GATEWAY_DEFAULT_WINDOW: "1100000",
  });
  assert.equal(config.defaultWindow, 1_100_000);
  assert.equal(modelWindow(config, "jojocodemax/gpt-6.1-sol"), 1_100_000, "选中的模型用网关窗口");
  assert.equal(modelWindow(config, "chatgpt/gpt-6.1-terra"), 200_000, "没声明的其它模型仍按 200k 兜底");
  // 写坏了就当没给：不因为一个环境变量让启动失败
  for (const value of ["", "abc", "0", "-1", "1.5"]) {
    const broken = runtimeConfig({
      CLAUDE_LOCAL_MANAGED: "1",
      CLAUDE_LOCAL_GATEWAY_URL: "https://localhost/gw/test/",
      CLAUDE_LOCAL_GATEWAY_MODEL: "jojocodemax/gpt-6.1-sol",
      CLAUDE_LOCAL_GATEWAY_KEY: "test",
      CLAUDE_LOCAL_GATEWAY_DEFAULT_WINDOW: value,
    });
    assert.equal(broken.defaultWindow, 200_000);
  }
});

test("gateway forwarding preserves the configured root, authentication and selected provider/model", async () => {
  for (const host of [undefined, "api.anthropic.com"]) {
    const result = await request(service, "/v1/messages?choice=1", {
      host, body: { model: modelIds[2], messages: [{ role: "user", content: "test prompt" }], diagnostics: {}, metadata: { diagnostics: {}, user_id: "preserved" } },
    });
    assert.equal(result.status, 200);
    const call = received.at(-1);
    assert.equal(call.path, "/gw/desktop/v1/messages?choice=1");
    assert.equal(call.headers.authorization, "Bearer test-local-gateway-token");
    assert.equal(call.headers["x-api-key"], "test-local-gateway-token");
    assert.equal(call.body.model, modelIds[2]);
    assert.equal(call.body.diagnostics, undefined);
    assert.deepEqual(call.body.metadata, { user_id: "preserved" });
  }
  const result = await request(service, "/v1/models");
  assert.deepEqual(result.json.data.map((entry) => entry.id), modelIds);
});

test("managed loopback routes reject cross-site and unauthenticated requests before attaching gateway credentials", async () => {
  const before = received.length;
  for (const options of [
    { auth: false },
    { extraHeaders: { authorization: "Bearer invalid" } },
    { extraHeaders: { origin: "https://untrusted.example" } },
    { extraHeaders: { origin: "null" } },
  ]) {
    const response = await request(service, "/v1/messages", { ...options, body: { model: modelIds[1], messages: [] } });
    assert.equal(response.status, 403);
  }
  assert.equal(received.length, before);
  const health = await request(service, "/__codex_claude_local/health", { extraHeaders: { origin: "null" } });
  assert.equal(health.status, 403);
});

test("RPC sends preserve model choice, switching, complete history and restart state", async () => {
  const conv = "a0a0a0a0-b1b1-42c2-83d3-e4e4e4e4e4e4";
  const rpc = (name, body) => request(service, `/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/${name}`, {
    host: "claude.ai", body, type: "application/proto",
  });
  await rpc("SendAndSettle", send(conv, "first test", modelIds[1]));
  assert.equal(received.at(-1).body.model, modelIds[1]);
  const switchModel = Buffer.concat([header(conv), ld(27, ld(1, ld(2, modelIds[2])))]);
  await rpc("PerformAction", switchModel);
  await rpc("SendAndSettle", send(conv, "second test"));
  assert.equal(received.at(-1).body.model, modelIds[2]);
  assert.deepEqual(received.at(-1).body.messages, [
    { role: "user", content: "first test" },
    { role: "assistant", content: "gateway reply" },
    { role: "user", content: "second test" },
  ]);
  await request(service, "/api/organizations/local/notification/preferences", {
    host: "claude.ai", method: "PATCH",
    body: { preferences: { feature_preference: { complete: { enable_email: false } } } },
  });
  await stop(service);
  const saved = JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8"));
  assert.equal(saved.conversations[0].turns[0].model, modelIds[1]);
  assert.equal(saved.conversations[0].model, modelIds[2]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(root, "state.json")).mode & 0o777, 0o600);
  }
  service = await start();
  await rpc("SendAndSettle", send(conv, "third test"));
  assert.equal(received.at(-1).body.model, modelIds[2]);
  assert.equal(received.at(-1).body.messages.length, 5);
  const history = await request(service, `/api/organizations/local/chat_conversations/${conv}`, { host: "claude.ai" });
  assert.deepEqual(history.json.chat_messages.map((message) => message.text), [
    "first test", "gateway reply", "second test", "gateway reply", "third test", "gateway reply",
  ]);
  const prefs = await request(service, "/api/organizations/local/notification/preferences", { host: "claude.ai" });
  assert.equal(prefs.json.preferences.feature_preference.complete.enable_email, false);
  assert.equal(service.output().includes("first test"), false);
  assert.equal(service.output().includes("test-local-gateway-token"), false);
});

test("managed SIGTERM and stdin closure flush state and release the listener", async () => {
  await stop(service, true);
  await assert.rejects(request(service, "/__codex_claude_local/health"));
  service = await start({
    CLAUDE_LOCAL_COMPUTER_USE: "1", CLAUDE_LOCAL_BACKGROUND_MODE: "0", CLAUDE_LOCAL_FORCE_BACKGROUND_MODE: "1",
    CLAUDE_LOCAL_LOCALIZATION: "0",
  });
  const flags = await request(service, "/api/desktop/features", { host: "claude.ai" });
  assert.deepEqual(flags.json.features["1291166712"].value, { enabled: true, appScopedEnabled: false });
  // 强制后台模式：把 macOS 版本上限抬高，新系统上不再判为「暂不支持」。
  assert.deepEqual(flags.json.features["1346958739"].value, { major: 99, minor: 9999 });
  const bootstrap = await request(service, "/edge-api/bootstrap", { host: "claude.ai" });
  assert.equal(bootstrap.json.locale, "en-US");
  const shell = await request(service, "/new", { host: "claude.ai" });
  assert.doesNotMatch(shell.bytes.toString("utf8"), /__codex_plus\/claude-localization\.js/);
  assert.doesNotMatch(shell.bytes.toString("utf8"), /name="i18n-catalogs"/);
  assert.equal((await request(service, "/__codex_plus/claude-localization.js", { host: "claude.ai" })).status, 404);
});

test("state loader validates contracts, preserves corrupt files and settles interrupted turns", () => {
  const invalid = path.join(root, "invalid.json");
  fs.writeFileSync(invalid, JSON.stringify({ version: 1, conversations: [{}], notifications: [] }));
  const original = fs.readFileSync(invalid);
  const warnings = [];
  const store = createStateStore(invalid, new Map(), new Map(), (message) => warnings.push(message));
  store.flush();
  assert.deepEqual(fs.readFileSync(invalid), original);
  assert.equal(warnings.length, 1);
  const oversized = path.join(root, "oversized.json");
  const fd = fs.openSync(oversized, "w", 0o600);
  fs.ftruncateSync(fd, 32 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  const oversizedWarnings = [];
  createStateStore(oversized, new Map(), new Map(), (message) => oversizedWarnings.push(message));
  assert.equal(oversizedWarnings.length, 1);
  const state = JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8"));
  state.conversations[0].turns[0].complete = false;
  fs.writeFileSync(path.join(root, "interrupted.json"), JSON.stringify(state));
  const conversations = new Map();
  createStateStore(path.join(root, "interrupted.json"), conversations, new Map());
  assert.equal(conversations.values().next().value.turns[0].stopReason, "interrupted");
  assert.equal(conversations.values().next().value.turns[0].complete, true);
});

test("gateway contracts keep duplicate model names distinct and old sessions use the default", () => {
  const config = runtimeConfig({
    CLAUDE_LOCAL_MANAGED: "1", CLAUDE_LOCAL_GATEWAY_URL: "https://localhost/gw/test/",
    CLAUDE_LOCAL_GATEWAY_MODEL: modelIds[0], CLAUDE_LOCAL_GATEWAY_KEY: "test",
    CLAUDE_LOCAL_GATEWAY_SMALL_MODEL: modelIds[2],
    CLAUDE_LOCAL_GATEWAY_MODELS: JSON.stringify(modelIds),
  });
  assert.equal(gatewayTarget(config, "/v1/messages?x=1").href, "https://localhost/gw/test/v1/messages?x=1");
  assert.equal(gatewayModel(config, modelIds[3]), modelIds[3]);
  assert.equal(gatewayModel(config, modelIds[4]), modelIds[4]);
  assert.equal(gatewayModel(config, undefined), modelIds[0]);
  assert.equal(gatewayModel(config, "claude-native-default"), modelIds[0]);
  assert.equal(gatewayModel(config, "claude-haiku-4-5"), modelIds[2]);
});

test("native bootstrap models without a provider are dropped from every picker list", () => {
  const base = {
    CLAUDE_LOCAL_MANAGED: "1", CLAUDE_LOCAL_GATEWAY_URL: "https://localhost/gw/test/",
    CLAUDE_LOCAL_GATEWAY_MODEL: modelIds[0], CLAUDE_LOCAL_GATEWAY_KEY: "test",
    CLAUDE_LOCAL_GATEWAY_MODELS: JSON.stringify(modelIds),
  };
  // 默认开；显式写 0 才关
  assert.equal(runtimeConfig(base).hideUnroutedModels, true);
  assert.equal(runtimeConfig({ ...base, CLAUDE_LOCAL_HIDE_UNROUTED_MODELS: "0" }).hideUnroutedModels, false);

  const config = runtimeConfig(base);
  const org = () => ({ claude_ai_bootstrap_models_config: [{ model: "claude-opus-5-5" }, { model: modelIds[1] }] });
  const growthbookModels = [{ model_id: "claude-sonnet-5-5" }];
  const bootstrap = {
    activeOrganization: org(),
    account: { memberships: [{ organization: org() }, {}] },
    claude_ai_available_models: { models: [{ model_id: "claude-haiku-5-5" }, { model_id: modelIds[0] }] },
    model_selector_config: [
      { id: "chat", models: [{ id: "claude-fable-5-1" }, { id: modelIds[2] }, { id: "beta/shared" }] },
      { id: "empty" },
    ],
    org_growthbook: { features: { list: { defaultValue: { models: growthbookModels } } } },
  };
  dropUnroutedModels(bootstrap, config);
  assert.deepEqual(bootstrap.activeOrganization.claude_ai_bootstrap_models_config.map((m) => m.model), [modelIds[1]]);
  assert.deepEqual(bootstrap.account.memberships[0].organization.claude_ai_bootstrap_models_config.map((m) => m.model), [modelIds[1]]);
  assert.deepEqual(bootstrap.claude_ai_available_models.models.map((m) => m.model_id), [modelIds[0]]);
  assert.deepEqual(bootstrap.model_selector_config[0].models.map((m) => m.id), [modelIds[2], "beta/shared"]);
  assert.equal(bootstrap.model_selector_config[1].models, undefined);
  // growthbook 不动
  assert.deepEqual(bootstrap.org_growthbook.features.list.defaultValue.models, growthbookModels);
});

test("recorded data dir opts managed mode into the PoC data path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-recorded-"));
  const env = {
    CLAUDE_LOCAL_MANAGED: "1", CLAUDE_LOCAL_GATEWAY_URL: "https://localhost/gw/test/",
    CLAUDE_LOCAL_GATEWAY_MODEL: "claude-test", CLAUDE_LOCAL_GATEWAY_KEY: "test",
    CLAUDE_LOCAL_RECORDED_DIR: dir,
  };
  // 未就绪（缺 .cache 和 mock/bootstrap.json）时保持合成数据路径
  assert.equal(runtimeConfig(env).recordedDir, null);
  fs.mkdirSync(path.join(dir, ".cache"));
  assert.equal(runtimeConfig(env).recordedDir, null);
  fs.mkdirSync(path.join(dir, "mock"));
  fs.writeFileSync(path.join(dir, "mock", "bootstrap.json"), "{}");
  assert.equal(runtimeConfig(env).recordedDir, dir);
  // 非托管模式下忽略该变量
  assert.equal(runtimeConfig({ CLAUDE_LOCAL_RECORDED_DIR: dir }).recordedDir, null);
  // 未提供时同样保持合成数据路径
  delete env.CLAUDE_LOCAL_RECORDED_DIR;
  assert.equal(runtimeConfig(env).recordedDir, null);
});

test("runtime config parses display name and plan with safe defaults", () => {
  assert.equal(runtimeConfig({}).displayName, "Local User");
  assert.equal(runtimeConfig({}).plan, "ultra");
  assert.equal(runtimeConfig({ CLAUDE_LOCAL_DISPLAY_NAME: "  张三  " }).displayName, "张三");
  assert.equal(runtimeConfig({ CLAUDE_LOCAL_DISPLAY_NAME: "a\nb\t" }).displayName, "ab");
  assert.equal(runtimeConfig({ CLAUDE_LOCAL_DISPLAY_NAME: "x".repeat(80) }).displayName.length, 64);
  assert.equal(runtimeConfig({ CLAUDE_LOCAL_DISPLAY_NAME: " \t\n " }).displayName, "Local User");
  assert.equal(runtimeConfig({}).email, "local@claude.local");
  assert.equal(runtimeConfig({ CLAUDE_LOCAL_EMAIL: "  me@example.com  " }).email, "me@example.com");
  for (const bad of ["", "no-at", "@b.c", "a@", "a b@c.d", "a@b\nc", `${"a".repeat(260)}@b.c`]) {
    assert.equal(runtimeConfig({ CLAUDE_LOCAL_EMAIL: bad }).email, "local@claude.local", bad);
  }
  for (const [raw, expected] of [["free", "free"], ["pro", "pro"], ["max", "max"], ["ultra", "ultra"], ["vip", "ultra"], ["", "ultra"]]) {
    assert.equal(runtimeConfig({ CLAUDE_LOCAL_PLAN: raw }).plan, expected, raw);
  }
});

test("plan profile covers all four tiers", () => {
  assert.equal(planProfile("free").plan, "free");
  assert.equal(planProfile("free").rateLimitTier, "default_claude_ai");
  assert.deepEqual(planProfile("pro").capabilities, ["claude_pro"]);
  assert.equal(planProfile("max").rateLimitTier, "default_claude_max_5x");
  assert.equal(planProfile("ultra").rateLimitTier, "default_claude_max_20x");
  assert.equal(planProfile("ultra").label, "Ultra");
  assert.equal(planProfile("nope").label, "Ultra");
});

test("runtime config parses model names and bad data falls back", () => {
  assert.deepEqual(runtimeConfig({}).modelNames, {});
  const ok = runtimeConfig({ CLAUDE_LOCAL_GATEWAY_MODEL_NAMES: '{"jojo/gpt-6.1-sol":{"name":"gpt-6.1-sol","description":"Jojo Codemax"}}' });
  assert.equal(ok.modelNames["jojo/gpt-6.1-sol"].name, "gpt-6.1-sol");
  assert.deepEqual(runtimeConfig({ CLAUDE_LOCAL_GATEWAY_MODEL_NAMES: "not json" }).modelNames, {});
  assert.deepEqual(runtimeConfig({ CLAUDE_LOCAL_GATEWAY_MODEL_NAMES: '{"a/b":{"name":5}}' }).modelNames, {});
});

test("model selectors use friendly names and fall back to ids", () => {
  const config = runtimeConfig({
    CLAUDE_LOCAL_GATEWAY_MODEL: "jojo/gpt-6.1-sol",
    CLAUDE_LOCAL_GATEWAY_MODELS: '["jojo/gpt-6.1-sol","other/raw-model"]',
    CLAUDE_LOCAL_GATEWAY_MODEL_NAMES: '{"jojo/gpt-6.1-sol":{"name":"gpt-6.1-sol","description":"Jojo Codemax"}}',
  });
  const models = modelSelectors(config).model_selector_config[0].models;
  const named = models.find((model) => model.id === "jojo/gpt-6.1-sol");
  assert.equal(named.name, "gpt-6.1-sol");
  assert.equal(named.short_name, "gpt-6.1-sol");
  assert.equal(named.description, "Jojo Codemax");
  assert.deepEqual(modelLabel(config, "jojo/gpt-6.1-sol"), { name: "gpt-6.1-sol", description: "Jojo Codemax" });
  assert.deepEqual(modelLabel(config, "other/raw-model"), { name: "other/raw-model", description: "" });
  const raw = models.find((model) => model.id === "other/raw-model");
  assert.equal(raw.name, "other/raw-model");
  assert.equal(raw.description, "");
});
