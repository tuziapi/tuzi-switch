// Real queue, canvas, IndexedDB and cache. Only the native HTTP boundary is synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { PNG } = require(
  require.resolve("pngjs", {
    paths: [require.resolve(process.env.PLAYWRIGHT_MODULE || "playwright")],
  }),
);
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const output =
  process.env.CREATIVE_QA_OUTPUT || "/tmp/creative-generation-acceptance";
fs.mkdirSync(output, { recursive: true });
const url = (process.env.CREATIVE_QA_BASE_URL || 'http://127.0.0.1:5197') + '/ui04.html?canvas=1&page=creative';
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
async function paintedCanvas(p, boardId, label) {
  const bs = await records(p, "aitu-workspace", "boards");
  const element = bs
    .find((x) => x.id === boardId)
    ?.elements.find((e) => e.type === "image" && e.generationTaskId);
  assert(element, "generated element must exist");
  const host = p
    .locator(`[plait-data-id="${element.id}"] foreignObject`)
    .first();
  // Wait for this result, not an unrelated toolbar/thumbnail image. Reopening
  // a project can briefly leave the board mounted under its loading screen.
  await p.waitForFunction((id) => {
    const image = document.querySelector(`[plait-data-id="${id}"] img`);
    return image?.complete && image.naturalWidth > 0 &&
      ![...document.querySelectorAll('.creative-root *')].some(node =>
        node.childElementCount === 0 && node.textContent === '正在读取本地项目...' &&
        node.getBoundingClientRect().height > 0);
  }, element.id);
  const rect = await host.boundingBox();
  assert(
    rect && rect.width > 20 && rect.height > 20,
    "image rectangle must be visible",
  );
  await p.waitForTimeout(400);
  const bytes = await p.screenshot({
    path: `${output}/${label}-paint.png`,
    clip: rect,
  });
  const png = PNG.sync.read(bytes);
  let red = 0,
    cyan = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = png.data.subarray(i, i + 3);
    if (r > 200 && g < 70 && b > 60 && b < 130) red++;
    if (r < 60 && g > 140 && b > 170) cyan++;
  }
  assert(
    red > png.width * png.height * 0.25 && cyan > png.width * png.height * 0.25,
    `canvas decoded but did not paint checkerboard: red=${red}, cyan=${cyan}, area=${png.width * png.height}`,
  );
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
(async () => {
  const b =
    engine === "webkit"
      ? null
      : await playwright[engine].launch({
          headless: true,
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        });
  const results = [];
  try {
    for (const scenario of process.env.CREATIVE_QA_SCENARIOS?.split(",") || [
      "stay",
      "assistant",
      "projects",
      "other-project",
      "unknown-result",
    ]) {
      // WebKit ephemeral contexts discard Cache Storage entries on reload. Use an
      // isolated persistent profile, matching the installed desktop's storage.
      const profile =
        engine === "webkit"
          ? fs.mkdtempSync(path.join(os.tmpdir(), "creative-webkit-"))
          : null;
      const c = profile
        ? await playwright.webkit.launchPersistentContext(profile, {
            headless: true,
            viewport: { width: 1180, height: 800 },
          })
        : await b.newContext({ viewport: { width: 1180, height: 800 } });
      const p = await c.newPage();
      p.setDefaultTimeout(15000);
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await c.route("**/*", (r) => {
        const u = new URL(r.request().url());
        return u.hostname === "127.0.0.1" ||
          ["data:", "blob:"].includes(u.protocol)
          ? r.continue()
          : r.abort();
      });
      try {
        await p.goto(url);
        await configure(p);
        await canvas(p);
        const original = (await records(p, "aitu-workspace", "boards"))[0];
        await p
          .locator(".ai-input-bar__input")
          .first()
          .fill("SYNTHETIC acceptance " + scenario);
        await p.evaluate((fail) => {
          window.__creativeRequestFixture.hold = true;
          window.__creativeRequestFixture.fail = fail;
        }, scenario === "unknown-result");
        await p.locator('[data-track="ai_input_click_send"]').first().click();
        await p.waitForFunction(() =>
          window.__creativeRequestFixture.requests.some(
            (r) => r.method === "POST",
          ),
        );
        const progress = p.locator(".image-generation-anchor-desktop-fallback");
        await progress.waitFor();
        assert.equal(await p.locator('.text-chat-creative-body').count(), 0,
          'legacy creative conversation must remain unmounted during generation');
        assert.equal(await p.getByRole('button', { name: '对话', exact: true }).getAttribute('aria-expanded'), 'false',
          'canvas generation must not open a conversation');
        assert(
          (await progress.textContent()).length > 0,
          "generation progress must have visible status",
        );
        await p.waitForTimeout(650); // allow empty-canvas hints and viewport scrolling to settle
        await p.screenshot({ path: `${output}/${scenario}-generating.png` });
        if (scenario === "assistant") {
          await p
            .getByRole("button", { name: "兔子助手导航", exact: true })
            .click();
          await p.getByRole("button", { name: "Codex", exact: true }).click();
          assert.equal(
            await p.locator(".plait-board-container").count(),
            0,
            "canvas must unmount on assistant pages",
          );
        }
        if (["projects", "other-project"].includes(scenario)) {
          await p
            .getByRole("navigation", { name: "创作导航" })
            .getByRole("button", { name: "我的项目", exact: true })
            .click();
          assert.equal(await p.locator(".plait-board-container").count(), 0);
          if (scenario === "other-project") {
            await p
              .getByRole("button", { name: "新建项目", exact: true })
              .click();
            await p.locator(".plait-board-container").waitFor();
          }
        }
        await p.evaluate(() => window.__creativeRequestFixture.release());
        if (scenario === "unknown-result") {
          await until(async () => {
            const t = (await records(p, "aitu-app", "tasks"))[0];
            return ["failed", "cancelled"].includes(t?.status);
          }, "unknown result not surfaced");
        } else {
          await until(
            async () =>
              (await records(p, "aitu-app", "tasks"))[0]?.status ===
              "completed",
            "background task did not complete",
          );
          if (scenario === "assistant")
            await p
              .getByRole("button", { name: "opentu 创作", exact: true })
              .click();
          if (scenario === "projects") await canvas(p);
          if (scenario === "other-project") {
            await p.waitForTimeout(2200);
            const bs = await records(p, "aitu-workspace", "boards");
            assert(
              bs
                .filter((x) => x.id !== original.id)
                .every((x) => !x.elements.some((e) => e.generationTaskId)),
              "result inserted into unrelated project",
            );
            await p
              .getByRole("navigation", { name: "创作导航" })
              .getByRole("button", { name: "我的项目", exact: true })
              .click();
            await p.getByText(original.name, { exact: true }).click();
          }
          await until(
            async () =>
              (await records(p, "aitu-app", "tasks"))[0]?.insertedToCanvas ===
              true,
            "completed result not delivered",
          );
          await until(
            async () =>
              (await records(p, "aitu-workspace", "boards")).some(
                (x) =>
                  x.id === original.id &&
                  x.elements.some(
                    (e) => e.type === "image" && e.generationTaskId,
                  ),
              ),
            "result not saved on original board",
          );
          await p.waitForFunction(() =>
            [...document.querySelectorAll(".plait-board-container img")].some(
              (i) => i.complete && i.naturalWidth > 0,
            ),
          );
        }
        if (scenario !== "unknown-result")
          await paintedCanvas(p, original.id, scenario + "-insert");
        const posts = await p.evaluate(
          () =>
            window.__creativeRequestFixture.requests.filter(
              (r) => r.method === "POST",
            ).length,
        );
        assert.equal(posts, 1, "duplicate generation submission");
        await p.reload();
        await p.locator(".plait-board-container").waitFor();
        await p.waitForTimeout(3500);
        assert.equal(
          await p.evaluate(
            () =>
              window.__creativeRequestFixture.requests.filter(
                (r) => r.method === "POST",
              ).length,
          ),
          0,
          "reload resubmitted generation",
        );
        if (scenario !== "unknown-result") {
          await p.waitForFunction(() =>
            [...document.querySelectorAll(".plait-board-container img")].some(
              (i) => i.complete && i.naturalWidth > 0,
            ),
          );
          const bs = await records(p, "aitu-workspace", "boards");
          assert.equal(
            bs
              .find((x) => x.id === original.id)
              .elements.filter((e) => e.type === "image" && e.generationTaskId)
              .length,
            1,
          );
        }
        if (scenario !== "unknown-result")
          await paintedCanvas(p, original.id, scenario + "-reload");
        assert.deepEqual(errors, []);
        results.push({ scenario, status: "passed", posts, reloadPosts: 0 });
      } catch (e) {
        results.push({ scenario, status: "failed", error: e.message });
        console.error(scenario, e.stack);
        fs.writeFileSync(
          `${output}/${scenario}-diagnostics.json`,
          JSON.stringify(
            {
              boards: await records(p, "aitu-workspace", "boards"),
              images: await p
                .locator(
                  ".plait-board-container img, .plait-board-container image",
                )
                .evaluateAll((es) =>
                  es.map((e) => ({
                    tag: e.tagName,
                    src: e.getAttribute("src") || e.getAttribute("href"),
                    complete: e.complete,
                    width: e.naturalWidth,
                    html: e.outerHTML,
                  })),
                ),
            },
            null,
            2,
          ),
        );
        process.exitCode = 1;
      }
      await p.screenshot({ path: `${output}/${scenario}.png` });
      fs.writeFileSync(
        output + "/results.json",
        JSON.stringify(results, null, 2),
      );
      await c.close();
      if (profile) fs.rmSync(profile, { recursive: true, force: true });
    }
  } finally {
    await b?.close();
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
