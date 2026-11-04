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
const output = process.env.CREATIVE_QA_OUTPUT || "/tmp/creative-image-menu";
fs.mkdirSync(output, { recursive: true });
const url = "http://127.0.0.1:5197/ui04.html?canvas=1&page=creative";
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "creative-menu-"));
  const c = await playwright[engine].launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1180, height: 800 },
    ...(engine === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const p = await c.newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await c.route("**/*", (r) => {
    const u = new URL(r.request().url());
    return u.hostname === "127.0.0.1" || ["data:", "blob:"].includes(u.protocol)
      ? r.continue()
      : r.abort();
  });
  const checks = [];
  try {
    await p.goto(url);
    await configure(p);
    await canvas(p);
    const original = (await records(p, "aitu-workspace", "boards"))[0];
    await p
      .locator(".ai-input-bar__input")
      .first()
      .fill("SYNTHETIC image context menu");
    await p.locator('[data-track="ai_input_click_send"]').first().click();
    await until(
      async () => (await records(p, "aitu-app", "tasks"))[0]?.insertedToCanvas,
      "image not delivered",
    );
    await paintedCanvas(p, original.id, "initial");
    const element = (
      await records(p, "aitu-workspace", "boards")
    )[0].elements.find((e) => e.type === "image");
    const loc = p
      .locator(`[plait-data-id="${element.id}"] foreignObject`)
      .first();
    const menu = p.locator(".canvas-image-menu");
    async function open() {
      const r = await loc.boundingBox();
      assert(r, "image visible");
      await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2, {
        button: "right",
      });
      await menu.waitFor();
    }
    await open();
    assert.equal(await menu.getByRole("menuitem").count(), 5);
    await p.screenshot({ path: `${output}/menu-light.png` });
    await p.keyboard.press("End");
    assert.equal(
      await p.evaluate(() => document.activeElement.textContent),
      "复制提示词",
    );
    await p.keyboard.press("Home");
    assert.equal(
      await p.evaluate(() => document.activeElement.textContent),
      "复制图片",
    );
    await p.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    checks.push("five actions, keyboard navigation, Escape");
    for (const [label, action] of [
      ["复制图片", "copy"],
      ["图片另存为…", "save"],
      ["显示图片文件", "reveal"],
    ]) {
      await open();
      await menu.getByRole("menuitem", { name: label, exact: true }).click();
      await p.waitForFunction(
        (action) =>
          window.__creativeImageFixture?.calls.some(
            (x) => x.args.request?.action === action,
          ),
        action,
      );
    }
    const calls = await p.evaluate(() => window.__creativeImageFixture.calls);
    assert.deepEqual(
      calls.map((c) => c.args.request.action),
      ["copy", "save", "reveal"],
    );
    for (const call of calls) {
      const png = PNG.sync.read(Buffer.from(call.args.request.data, "base64"));
      assert.equal(png.width, 64);
      assert.equal(png.height, 64);
      assert.equal(
        call.args.request.data,
        calls[0].args.request.data,
        "all actions get same original bytes",
      );
      assert.equal(call.args.request.name, `image-${element.id}`);
    }
    checks.push("copy/save/reveal original bytes via native boundary");
    await open();
    await menu
      .getByRole("menuitem", { name: "复制提示词", exact: true })
      .click();
    await p.waitForFunction(() =>
      window.__creativeImageFixture.calls.some(
        (x) => x.command === "copy_text_to_clipboard",
      ),
    );
    assert.equal(
      await p.evaluate(
        () =>
          window.__creativeImageFixture.calls.find(
            (x) => x.command === "copy_text_to_clipboard",
          ).args.text,
      ),
      "SYNTHETIC image context menu",
    );
    checks.push("exact generation prompt");
    await p.waitForTimeout(3500); // expire previous success toasts
    await p.evaluate(() => {
      window.__creativeImageFixture.next = "cancelled";
    });
    await open();
    await menu
      .getByRole("menuitem", { name: "图片另存为…", exact: true })
      .click();
    await p.waitForTimeout(600);
    assert.equal(await p.getByText("图片已保存", { exact: true }).count(), 0);
    await p.evaluate(() => {
      window.__creativeImageFixture.error = "SYNTHETIC 磁盘空间不足";
    });
    await open();
    await menu
      .getByRole("menuitem", { name: "显示图片文件", exact: true })
      .click();
    await p.getByText("SYNTHETIC 磁盘空间不足", { exact: true }).waitFor();
    checks.push("cancel is silent and native error surfaced");
    await open();
    await menu.getByRole("menuitem", { name: "预览原图", exact: true }).click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${output}/preview.png` });
    assert(await p.locator(".unified-viewer").count(), "preview mounted");
    const saves = await p.evaluate(
      () =>
        window.__creativeImageFixture.calls.filter(
          (c) => c.args.request?.action === "save",
        ).length,
    );
    await p
      .locator(".unified-viewer")
      .getByRole("button", { name: "下载图片或媒体" })
      .click();
    await p.waitForFunction(
      (n) =>
        window.__creativeImageFixture.calls.filter(
          (c) => c.args.request?.action === "save",
        ).length ===
        n + 1,
      saves,
    );
    await p.keyboard.press("Escape");
    checks.push("original preview and native save from preview");
    await p.reload();
    await p.locator(".plait-board-container").waitFor();
    await p.waitForTimeout(3500);
    await paintedCanvas(p, original.id, "reload");
    await open();
    await menu.getByRole("menuitem", { name: "复制图片", exact: true }).click();
    await p.waitForFunction(
      () => window.__creativeImageFixture?.calls.length === 1,
    );
    assert.equal(
      await p.evaluate(
        () => window.__creativeImageFixture.calls[0].args.request.data,
      ),
      calls[0].args.request.data,
    );
    assert.equal(
      await p.evaluate(
        () =>
          window.__creativeRequestFixture.requests.filter(
            (x) => x.method === "POST",
          ).length,
      ),
      0,
    );
    checks.push("reload export from original cache without generation");
    // Theme and edge clamp: trigger the actual handler with image coordinates near
    // the image edge, at a narrow viewport and while the image is selected.
    await p.evaluate(() =>
      document
        .querySelector(".creative-root")
        .setAttribute("data-theme", "dark"),
    );
    await p.setViewportSize({ width: 850, height: 620 });
    await open();
    const rect = await menu.boundingBox();
    assert(
      rect.x >= 8 &&
        rect.y >= 8 &&
        rect.x + rect.width <= 850 &&
        rect.y + rect.height <= 620,
    );
    await p.screenshot({ path: `${output}/menu-dark-narrow.png` });
    await p.mouse.click(820, 50);
    await menu.waitFor({ state: "hidden" });
    checks.push("dark narrow viewport bounds and outside dismissal");
    // Overlapping imported image must receive the action, regardless of earlier selection.
    await p.evaluate(() => {
      const board = window.__drawnixBoard;
      const original = board.children.find((e) => e.type === "image");
      const node = {
        ...structuredClone(original),
        id: "synthetic-top-image",
        generationPrompt: "",
        aiPrompt: "",
        prompt: "",
        generationTaskId: undefined,
      };
      board.apply({ type: "insert_node", node, path: [board.children.length] });
    });
    await p.waitForTimeout(300);
    await open();
    assert(
      await menu
        .getByRole("menuitem", { name: "复制提示词", exact: true })
        .isDisabled(),
    );
    const previous = await p.evaluate(
      () => window.__creativeImageFixture.calls.length,
    );
    await menu.getByRole("menuitem", { name: "复制图片", exact: true }).click();
    await p.waitForFunction(
      (n) => window.__creativeImageFixture.calls.length === n + 1,
      previous,
    );
    assert.equal(
      await p.evaluate(
        () => window.__creativeImageFixture.calls.at(-1).args.request.name,
      ),
      "image-synthetic-top-image",
    );
    checks.push("right-click targets top image and disables missing prompt");
    await p.evaluate(() => {
      const board = window.__drawnixBoard;
      const index = board.children.findIndex(
        (e) => e.id === "synthetic-top-image",
      );
      board.apply({
        type: "set_node",
        path: [index],
        properties: { url: board.children[index].url },
        newProperties: {
          url: "/__aitu_cache__/synthetic-deleted-original.png",
        },
      });
    });
    await p.waitForTimeout(300);
    await open();
    const beforeMissing = await p.evaluate(
      () => window.__creativeImageFixture.calls.length,
    );
    await menu.getByRole("menuitem", { name: "复制图片", exact: true }).click();
    await p
      .getByText("原图缓存暂不可用，请从任务列表找回已有结果后重试。", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await p.evaluate(() => window.__creativeImageFixture.calls.length),
      beforeMissing,
    );
    assert.equal(
      await p.evaluate(
        () =>
          window.__creativeRequestFixture.requests.filter(
            (x) => x.method === "POST",
          ).length,
      ),
      0,
    );
    checks.push(
      "missing original reports failure without export, thumbnail or regeneration",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      `${output}/report.json`,
      JSON.stringify({ engine, checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ engine, checks, errors }, null, 2));
  } catch (error) {
    await p.screenshot({ path: `${output}/failure.png` });
    fs.writeFileSync(
      `${output}/failure.txt`,
      `${error.stack}\n${await p.locator("body").innerText()}`,
    );
    throw error;
  } finally {
    await c.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
