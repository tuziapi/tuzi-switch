// Uses real host/creative UI with synthetic IPC and blocked external traffic.
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const fs = require("fs");
const assert = require("assert/strict");
const out = process.env.CREATIVE_QA_OUTPUT || "/tmp/opentu-sync-ui";
fs.mkdirSync(out, { recursive: true });
const base = process.env.CREATIVE_QA_BASE_URL || "http://127.0.0.1:5197";
const model = process.env.CREATIVE_QA_MODEL || "gpt-image-2.6-1k";
const gif = fs
  .readFileSync(
    require("path").join(__dirname, "fixtures/synthetic-animation.gif"),
  )
  .toString("base64");
(async () => {
  const browser = await pw[engine].launch({
    headless: true,
    ...(engine === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const results = [];
  try {
    for (const theme of process.env.CREATIVE_QA_SKIP_ICONS
      ? []
      : ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 1360, height: 1000 },
      });
      const p = await context.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.route("**/*", (r) => {
        const u = new URL(r.request().url());
        return u.hostname === "127.0.0.1" ||
          ["data:", "blob:"].includes(u.protocol)
          ? r.continue()
          : r.abort();
      });
      await p.goto(`${base}/ui04.html?canvas=1&theme=${theme}`);
      const button = p.getByRole("button", {
        name: "opentu 创作",
        exact: true,
      });
      await button.waitFor();
      assert(
        await button
          .locator("img")
          .evaluate((im) => im.complete && im.naturalWidth === 192),
      );
      await p.screenshot({ path: `${out}/icon-${theme}-expanded.png` });
      await p.getByRole("button", { name: "收起侧栏", exact: true }).click();
      assert(await button.locator("img").isVisible());
      await p.screenshot({ path: `${out}/icon-${theme}-collapsed.png` });
      await button.click();
      await p
        .getByRole("button", { name: "兔子助手导航", exact: true })
        .click();
      assert(
        await p
          .getByRole("button", { name: "opentu 创作", exact: true })
          .locator("img")
          .isVisible(),
      );
      await p.screenshot({ path: `${out}/icon-${theme}-menu.png` });
      assert.deepEqual(errors, []);
      results.push({ theme, icon: "passed", pageErrors: errors });
      await context.close();
    }
    for (const outcome of ["failure", "gif"]) {
      const c = await browser.newContext({
        viewport: { width: 1600, height: 1200 },
      });
      const p = await c.newPage();
      p.setDefaultTimeout(20000);
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.route("**/*", (r) => {
        const u = new URL(r.request().url());
        return u.hostname === "127.0.0.1" ||
          ["data:", "blob:"].includes(u.protocol)
          ? r.continue()
          : r.abort();
      });
      await p.addInitScript(() => localStorage.setItem('aitu_hide_inspiration_board', 'true'));
      await p.goto(`${base}/ui04.html?canvas=1&page=creative&media-qa=1`);
      await p.evaluate(
        ({ model, outcome, gif }) => {
          Object.assign(window.__creativeRequestFixture.responses, {
            "GET /v1/models": {
              body: {
                data: [
                  {
                    id: model,
                    supported_endpoint_types: ["image-generation"],
                    endpoints: {
                      "image-generation": {
                        path: "/v1/images/generations",
                        method: "POST",
                      },
                    },
                  },
                ],
              },
            },
            "POST /v1/images/generations":
              outcome === "failure"
                ? {
                    status: 422,
                    body: {
                      error: {
                        message:
                          "SYNTHETIC rejected (request id: provider-126)",
                        code: "validation",
                      },
                      task_id: "remote-126",
                    },
                  }
                : {
                    body: {
                      data: [{ b64_json: gif, width: 256, height: 192 }],
                    },
                  },
          });
        },
        { model, outcome, gif },
      );
      await p.getByRole("button", { name: "创作配置", exact: true }).click();
      const d = p.getByTestId("settings-dialog");
      await d.getByRole("button", { name: "兔子账户", exact: true }).click();
      await d.getByText("合成开发密钥", { exact: true }).click();
      await d.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
      await p.getByText(model, { exact: true }).last().waitFor();
      await p.getByRole("button", { name: "全选", exact: true }).click();
      await p.getByRole("button", { name: "添加模型", exact: true }).click();
      await d.getByText("已添加 1 个", { exact: true }).waitFor();
      await d.getByRole("button", { name: "保存", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await p
        .getByRole("navigation", { name: "创作导航" })
        .getByRole("button", { name: "自由画布", exact: true })
        .click();
      await p.locator(".plait-board-container").waitFor();
      const intro = p.getByText("不再提示", { exact: true });
      if (await intro.isVisible()) await intro.click();
      await p.locator(".model-dropdown__trigger:visible").first().click();
      await p.getByText(model, { exact: true }).last().click();
      await p
        .locator(".ai-input-bar__input:visible")
        .first()
        .fill("SYNTHETIC GIF");
      await p
        .locator('[data-track="ai_input_click_send"]:visible')
        .first()
        .click();
      if (outcome === "failure") {
        const card = p.locator(".image-generation-anchor-desktop-fallback");
        await card.getByText("provider-126", { exact: true }).waitFor();
        await card.getByRole("button", { name: "复制 全部错误信息" }).click();
        await p.waitForFunction(() =>
          window.__creativeImageFixture?.calls.some(
            (c) => c.command === "copy_text_to_clipboard",
          ),
        );
        const copied = await p.evaluate(
          () =>
            window.__creativeImageFixture.calls.find(
              (c) => c.command === "copy_text_to_clipboard",
            ).args,
        );
        assert(JSON.stringify(copied).includes("provider-126"));
        assert(JSON.stringify(copied).includes(model));
        const hint = p.getByText("不再提示", { exact: true });
        if (await hint.isVisible()) await hint.click();
        await p.keyboard.press("Escape");
        await p.getByTestId("zoom-display").click();
        await p.locator('[data-track="view_nav_zoom_fit"]').click();
        await p.screenshot({ path: `${out}/native-image-failure.png` });
      } else {
        await p.waitForFunction(() =>
          [
            ...document.querySelectorAll(
              ".plait-board-container img.image-origin",
            ),
          ].some((im) => im.complete && im.naturalWidth === 256),
        );
        const frameHashes = [];
        for (let frame = 0; frame < 6; frame++) {
          await p.waitForFunction(() =>
            [
              ...document.querySelectorAll(
                ".plait-board-container image[data-native-image-overlay]",
              ),
            ].some((im) => {
              const rect = im.getBoundingClientRect();
              return rect.width > 20 && rect.height > 20;
            }),
          );
          const clip = await p.evaluate(() => {
            const im = [
              ...document.querySelectorAll(
                ".plait-board-container image[data-native-image-overlay]",
              ),
            ].find((im) => {
              const rect = im.getBoundingClientRect();
              return rect.width > 20 && rect.height > 20;
            });
            if (!im) return null;
            const { x, y, width, height } = im.getBoundingClientRect();
            return { x, y, width, height };
          });
          assert(
            clip && clip.width > 20 && clip.height > 20,
            "GIF has visible native bounds",
          );
          const bytes = await p.screenshot({
            path: `${out}/gif-frame-${frame}.png`,
            clip,
          });
          frameHashes.push(
            require("crypto").createHash("sha256").update(bytes).digest("hex"),
          );
          await p.waitForTimeout(250);
        }
        assert(
          new Set(frameHashes).size > 1,
          "GIF must animate on the native SVG canvas",
        );
        const colors = require("child_process").spawnSync(
          "python3",
          [
            "-c",
            'from PIL import Image; import sys; images=[Image.open(p).convert("RGB") for p in sys.argv[1:]]; colors=[im.getpixel((im.width//2,im.height//2)) for im in images]; assert (245,20,90) in colors and (10,180,220) in colors, colors; print(colors)',
            ...Array.from({ length: 6 }, (_, i) => `${out}/gif-frame-${i}.png`),
          ],
          { encoding: "utf8" },
        );
        assert.equal(colors.status, 0, colors.stderr);
        await p.screenshot({ path: `${out}/native-gif-result.png` });
      }
      assert.deepEqual(errors, []);
      results.push({ outcome, status: "passed", pageErrors: errors });
      await c.close();
    }
    fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
