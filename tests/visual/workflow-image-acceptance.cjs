// Real queue, canvas, IndexedDB and cache. Only the native HTTP boundary is synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const output =
  process.env.CREATIVE_QA_OUTPUT || "/tmp/creative-generation-acceptance";
fs.mkdirSync(output, { recursive: true });
const url =
  (process.env.CREATIVE_QA_BASE_URL || "http://127.0.0.1:5197") +
  "/ui04.html?canvas=1&page=creative";
async function records(page, db, store) {
  return page.evaluate(
    ({ db, store }) =>
      new Promise((resolve, reject) => {
        const o = indexedDB.open(db);
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const d = o.result,
            q = d.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => {
            resolve(q.result);
            d.close();
          };
          q.onerror = () => reject(q.error);
        };
      }),
    { db, store },
  );
}
async function until(fn, description) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(description);
}
async function canvas(p) {
  await p
    .getByRole("navigation", { name: "创作导航" })
    .getByRole("button", { name: "自由画布", exact: true })
    .click();
  await p.locator(".plait-board-container").waitFor();
  const intro = p.getByText("不再提示", { exact: true });
  if (await intro.isVisible()) await intro.click();
}
async function configure(p) {
  await p.getByRole("button", { name: "创作配置", exact: true }).click();
  const d = p.getByTestId("settings-dialog");
  await d.waitFor();
  await d.getByRole("button", { name: "手动配置", exact: true }).click();
  await d.locator("input[type=password]").fill("sk-SYNTHETIC-GENERATION");
  await d
    .locator(".settings-dialog__field")
    .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
    .locator("input")
    .first()
    .fill("https://creative.synthetic.invalid/v1");
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await d.waitFor({ state: "hidden" });
}
// Pixel checks use actual screenshots, not merely image.complete.
async function painted(page, locator, label) {
  await locator.waitFor();
  await page.waitForFunction(() => {
    const i = document.querySelector(".workflow-bubble__media-item img");
    return (
      i?.complete &&
      i.naturalWidth > 0 &&
      getComputedStyle(i).visibility === "visible"
    );
  });
  await locator.scrollIntoViewIfNeeded();
  const file = `${output}/${label}.png`;
  await locator.screenshot({ path: file });
  const result = JSON.parse(
    require("node:child_process").execFileSync(
      "python3",
      [
        "-c",
        `
from PIL import Image
import sys,json
im=Image.open(sys.argv[1]).convert('RGB');px=list(im.getdata())
r=sum(r>200 and g<70 and 60<b<130 for r,g,b in px)
c=sum(r<60 and g>140 and b>170 for r,g,b in px)
print(json.dumps({'red':r,'cyan':c,'area':len(px)}))
`,
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  assert(
    result.red > result.area * 0.25 && result.cyan > result.area * 0.25,
    JSON.stringify(result),
  );
  return result;
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-image-qa-"));
  const c = await playwright[engine].launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1360, height: 900 },
    ...(engine === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const p = await c.newPage();
  p.setDefaultTimeout(30_000);
  const errors = [],
    checks = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await c.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1" ||
    /^(data:|blob:)/.test(r.request().url())
      ? r.continue()
      : r.abort(),
  );
  const posts = () =>
    p.evaluate(
      () =>
        window.__creativeRequestFixture.requests.filter(
          (r) => r.method === "POST",
        ).length,
    );
  async function assistant() {
    const toggle = p.getByRole("button", { name: "对话", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    await p.getByRole("button", { name: "创作助手", exact: true }).click();
    await p.locator(".workflow-bubble__media-item").first().waitFor();
  }
  try {
    await p.goto(url);
    await configure(p);
    await canvas(p);
    await p.waitForTimeout(1000);
    await p
      .locator(".ai-input-bar__input")
      .first()
      .fill("SYNTHETIC 图片显示回归");
    await p.waitForTimeout(250);
    await p.locator('[data-track="ai_input_click_send"]').first().click();
    await until(
      async () =>
        (await records(p, "aitu-app", "tasks"))[0]?.insertedToCanvas === true,
      "generation result missing",
    );
    // Insertion can close the drawer; wait for the existing canvas fit transition.
    await p.waitForTimeout(3000);
    await assistant();
    const card = p.locator(".workflow-bubble__media-item").first();
    checks.push({
      name: "generated cache image paints in assistant",
      pixels: await painted(p, card, "assistant-result"),
    });
    assert.equal(await posts(), 1);
    await p.screenshot({ path: output + "/assistant-page.png" });
    await card.click();
    await p.locator(".unified-viewer").waitFor();
    await p.waitForFunction(() =>
      [...document.querySelectorAll(".unified-viewer img")].some(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    );
    await p.keyboard.press("Escape");
    checks.push({
      name: "single click opens loaded full preview",
      status: "passed",
    });
    await p.reload();
    await p.locator(".plait-board-container").waitFor();
    await assistant();
    checks.push({
      name: "reload preserves image without generation",
      pixels: await painted(p, card, "assistant-reload"),
    });
    assert.equal(await posts(), 0);
    await p.getByRole("button", { name: "关闭对话面板", exact: true }).click();
    await assistant();
    await painted(p, card, "assistant-reopen");
    checks.push({
      name: "close and reopen preserves result",
      status: "passed",
    });
    // Remove only this synthetic image from Cache Storage; keep bytes for recovery.
    const cacheBackup = await p.evaluate(async () => {
      const entries = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys())
          if (request.url.includes("/__aitu_cache__/image/")) {
            const response = await cache.match(request);
            entries.push({
              name,
              url: request.url,
              type: response.headers.get("content-type"),
              bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
            });
            await cache.delete(request);
          }
      }
      return entries;
    });
    assert(cacheBackup.length > 0, "expected actual cache entry");
    await p.reload();
    await p.locator(".plait-board-container").waitFor();
    await assistant();
    const retry = p.getByRole("button", {
      name: "重新加载生成结果 1",
      exact: true,
    });
    await retry.waitFor();
    await retry.screenshot({ path: output + "/assistant-missing.png" });
    assert.equal(await posts(), 0);
    checks.push({
      name: "missing cache shows explicit display failure, no new generation",
      status: "passed",
    });
    await p.evaluate(async (entries) => {
      for (const e of entries)
        await (
          await caches.open(e.name)
        ).put(
          e.url,
          new Response(new Uint8Array(e.bytes), {
            headers: { "Content-Type": e.type },
          }),
        );
    }, cacheBackup);
    await retry.focus();
    await p.keyboard.press("Enter");
    checks.push({
      name: "keyboard reload recovers same cached result",
      pixels: await painted(p, card, "assistant-recovered"),
    });
    assert.equal(await posts(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      `${output}/results.json`,
      JSON.stringify(
        {
          engine,
          status: "passed",
          checks,
          errors,
          realProvider: false,
          nativeUI: false,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ engine, checks, errors }));
  } catch (e) {
    await p.screenshot({ path: output + "/failure.png" });
    fs.writeFileSync(
      `${output}/results.json`,
      JSON.stringify(
        {
          engine,
          status: "failed",
          checks,
          error: e.message,
          errors,
          requests: await p.evaluate(
            () => window.__creativeRequestFixture.requests,
          ),
          images: await p
            .locator(".workflow-bubble__media-item")
            .evaluateAll((es) => es.map((e) => e.outerHTML)),
        },
        null,
        2,
      ),
    );
    console.error(e);
    process.exitCode = 1;
  } finally {
    await c.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
