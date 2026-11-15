// Real native SVG canvas path and persistence; provider HTTP remains synthetic.
const { chromium, webkit } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const fs = require("node:fs");
const assert = require("node:assert/strict");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const output = process.env.CREATIVE_QA_OUTPUT || "/tmp/tuzi-error-card";
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  await context.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1" ||
    /^(data:|blob:)/.test(r.request().url())
      ? r.continue()
      : r.abort(),
  );
  const p = await context.newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  const checks = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto("http://127.0.0.1:5211/ui04.html?canvas=1&page=creative");
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    const d = p.getByTestId("settings-dialog");
    await d.getByRole("button", { name: "手动配置", exact: true }).click();
    await d.locator("input[type=password]").fill("sk-SYNTHETIC-ERROR-CARD");
    await d
      .locator(".settings-dialog__field")
      .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
      .locator("input")
      .first()
      .fill("https://creative.synthetic.invalid/v1");
    await d.getByRole("button", { name: "保存", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    await p.getByRole("button", { name: "自由画布", exact: true }).click();
    const intro = p.getByText("不再提示", { exact: true });
    if (await intro.isVisible()) await intro.click();
    await p.evaluate(() => {
      for (const path of ["/v1/images/generations", "/v1/chat/completions"])
        window.__creativeRequestFixture.responses["POST " + path] = {
          status: 400,
          body: {
            error: {
              message: "SYNTHETIC 模型配置读取失败，请检查后重试",
              code: "invalid_model",
            },
          },
        };
      window.__errorCardEvents = [];
      for (const type of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
      ])
        document.addEventListener(
          type,
          (event) => {
            const button = event.target.closest?.('[role="button"]');
            if (button?.closest(".image-generation-anchor-desktop-fallback"))
              window.__errorCardEvents.push({
                type,
                label: button.getAttribute("aria-label"),
              });
          },
          true,
        );
    });
    await p.locator(".count-dropdown__trigger").first().click();
    await p
      .locator(".count-dropdown__item")
      .filter({ hasText: /^3个$/ })
      .click();
    await p
      .locator(".ai-input-bar__input")
      .first()
      .fill("SYNTHETIC error card retry and close");
    await p.locator('[data-track="ai_input_click_send"]').first().click();
    const selector =
      '.image-generation-anchor-desktop-fallback[aria-label="生成失败"]';
    await p.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 3,
      selector,
    );
    await p.locator('[data-track="view_nav_zoom_menu"]').first().click();
    await p.locator('[data-track="view_nav_zoom_fit"]').first().click();
    await p.waitForTimeout(400);
    const ids = await p
      .locator(selector)
      .evaluateAll((nodes) =>
        nodes.map((el) =>
          el.closest("[plait-data-id]").getAttribute("plait-data-id"),
        ),
      );
    const card = p.locator(`[plait-data-id="${ids[0]}"] ${selector}`);
    await p.screenshot({ path: output + "/" + engine + "-light.png" });
    const background = () =>
      card.locator(":scope > rect").evaluate((el) => getComputedStyle(el).fill);
    assert.equal(await background(), "rgb(255, 255, 255)");
    await p.evaluate(() =>
      document
        .querySelector(".creative-root")
        .setAttribute("data-theme", "dark"),
    );
    assert.equal(await background(), "rgb(41, 45, 43)");
    await p.screenshot({ path: output + "/" + engine + "-dark.png" });
    await p.evaluate(() =>
      document
        .querySelector(".creative-root")
        .setAttribute("data-theme", "light"),
    );
    checks.push("three real canvas failures, light/dark neutral card colors");
    await card
      .getByRole("button", { name: "复制 全部错误信息", exact: true })
      .click();
    await p.waitForFunction(() =>
      window.__creativeImageFixture?.calls.some(
        (call) => call.command === "copy_text_to_clipboard",
      ),
    );
    checks.push("copy report remains available");
    const postCount = () =>
      p.evaluate(
        () =>
          window.__creativeRequestFixture.requests.filter(
            (r) => r.method === "POST",
          ).length,
      );
    const before = await postCount();
    for (const activation of ["pointer", "keyboard"]) {
      await p.evaluate(() => (window.__creativeRequestFixture.hold = true));
      if (activation === "pointer")
        await card
          .getByRole("button", { name: "重试", exact: true })
          .click({ delay: 120 });
      else
        await card
          .getByRole("button", { name: "重试", exact: true })
          .press("Enter");
      const expected = before + (activation === "pointer" ? 1 : 2);
      await p.waitForFunction(
        (expected) =>
          window.__creativeRequestFixture.requests.filter(
            (r) => r.method === "POST",
          ).length === expected,
        expected,
      );
      await card.waitFor({ state: "detached" });
      assert.equal(
        await p.locator(selector).count(),
        2,
        "retry must affect only its own slot",
      );
      await p.waitForTimeout(250);
      assert.equal(
        await postCount(),
        expected,
        "one request per explicit activation",
      );
      await p.evaluate(() => window.__creativeRequestFixture.release());
      await card.waitFor();
    }
    checks.push(
      "pointer and keyboard retry each issue one synthetic request and preserve other slots",
    );
    await card
      .getByRole("button", { name: "关闭", exact: true })
      .click({ delay: 120 });
    await card.waitFor({ state: "detached" });
    assert.equal(await p.locator(selector).count(), 2);
    assert.deepEqual(
      await p
        .locator(selector)
        .evaluateAll((nodes) =>
          nodes.map((el) =>
            el.closest("[plait-data-id]").getAttribute("plait-data-id"),
          ),
        ),
      ids.slice(1),
    );
    checks.push(
      "close removes the current live node only, without node-path errors",
    );
    await p.waitForFunction(async (id) => {
      const request = indexedDB.open("aitu-workspace");
      const db = await new Promise(
        (resolve) => (request.onsuccess = () => resolve(request.result)),
      );
      const read = db.transaction("boards").objectStore("boards").getAll();
      const records = await new Promise(
        (resolve) => (read.onsuccess = () => resolve(read.result)),
      );
      db.close();
      return (
        records.some((board) =>
          board.elements?.some((e) => e.type === "generation-anchor"),
        ) && !records.some((board) => board.elements?.some((e) => e.id === id))
      );
    }, ids[0]);
    await p.reload();
    await p.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 2,
      selector,
    );
    await p.waitForTimeout(500);
    assert.equal(await p.locator(`[plait-data-id="${ids[0]}"]`).count(), 0);
    checks.push("closed card remains removed after save and reload");
    await p
      .locator(selector)
      .first()
      .getByRole("button", { name: "关闭", exact: true })
      .press(" ");
    await p.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 1,
      selector,
    );
    checks.push("keyboard Space closes a restored card");
    await p.screenshot({ path: output + "/" + engine + "-after.png" });
    assert.deepEqual(errors, []);
    checks.push("no runtime exceptions");
    fs.writeFileSync(
      output + "/" + engine + "-checks.json",
      JSON.stringify(
        { engine, checks, errors, requests: "synthetic only" },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ engine, checks, errors }, null, 2));
  } catch (error) {
    await p.screenshot({ path: output + "/" + engine + "-failure.png" });
    fs.writeFileSync(
      output + "/" + engine + "-failure.txt",
      await p.locator("body").innerText(),
    );
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
