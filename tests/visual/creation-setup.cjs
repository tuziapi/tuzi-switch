// Isolated production UI: all provider calls use synthetic transport.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.TEXT_CHAT_BROWSER || "chromium";
const output = process.env.TEXT_CHAT_OUTPUT || "/tmp/tuzi-creation-qa";
fs.mkdirSync(output, { recursive: true });
(async () => {
  const b = await pw[engine].launch(
    engine === "chromium"
      ? {
          headless: true,
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : { headless: true },
  );
  const c = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await c.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1" ||
    /^(data:|blob:)/.test(r.request().url())
      ? r.continue()
      : r.abort(),
  );
  const p = await c.newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const checks = [];
  try {
    await p.goto(
      process.env.TEXT_CHAT_URL ||
        "http://127.0.0.1:5212/ui04.html?canvas=1&page=creative&native-titlebar=mac&media-qa=1",
    );
    await p
      .getByRole("navigation", { name: "创作导航" })
      .getByRole("button", { name: "自由画布", exact: true })
      .click();
    await p.locator(".plait-board-container").waitFor();
    const d = p.getByTestId("settings-dialog");
    assert.equal(await d.count(), 0);
    if (await p.getByText("不再提示", { exact: true }).isVisible())
      await p.getByText("不再提示", { exact: true }).click();
    for (const type of ["图片", "视频", "音频", "文本"]) {
      await p.locator(".generation-type-dropdown__trigger").click();
      await p
        .locator(".generation-type-dropdown__item")
        .filter({ hasText: type })
        .click();
      await p.getByTestId("ai-input-textarea").fill("测试草稿 " + type);
      await p.locator(".ai-input-bar__send-btn").click();
      await d.waitFor();
      assert.equal(
        await p.getByTestId("ai-input-textarea").inputValue(),
        "测试草稿 " + type,
      );
      assert.equal(
        await p.evaluate(() => window.__creativeRequestFixture.requests.length),
        0,
      );
      await d.getByRole("button", { name: "关闭", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      checks.push(
        type + " missing setup opens dialog without request or draft loss",
      );
    }
    await p.locator(".discussion-strip__open").click();
    await p.getByTestId("ai-input-textarea").fill("讨论草稿");
    await p.locator(".ai-input-bar__send-btn").click();
    await d.waitFor();
    assert.equal(
      await p.getByTestId("ai-input-textarea").inputValue(),
      "讨论草稿",
    );
    assert.equal(
      await p.evaluate(() => window.__creativeRequestFixture.requests.length),
      0,
    );
    await d.getByRole("button", { name: "关闭", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    checks.push("main discussion retains draft and blocks request");
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p
      .getByRole("textbox", { name: "文本消息", exact: true })
      .fill("侧边草稿");
    await p.getByRole("button", { name: "发送文本消息", exact: true }).click();
    await d.waitFor();
    assert.equal(
      await p
        .getByRole("textbox", { name: "文本消息", exact: true })
        .inputValue(),
      "侧边草稿",
    );
    assert.equal(
      await p.evaluate(() => window.__creativeRequestFixture.requests.length),
      0,
    );
    await d.getByRole("button", { name: "关闭", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    checks.push("sidebar retains draft and opens setup");
    await p.getByRole("button", { name: "对话", exact: true }).click();
    // Configure through the existing account UI using only the synthetic transport.
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["GET /v1/models"] = {
        body: {
          data: [
            {
              id: "gpt-image-2",
              supported_endpoint_types: ["image-generation"],
              endpoints: {
                "image-generation": {
                  path: "/v1/images/generations",
                  method: "POST",
                },
              },
            },
            {
              id: "gpt-4o",
              supported_endpoint_types: ["openai"],
              endpoints: {
                openai: { path: "/v1/chat/completions", method: "POST" },
              },
            },
          ],
        },
      };
    });
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    await d.getByRole("button", { name: "兔子账户", exact: true }).click();
    await d.getByText("合成开发密钥", { exact: true }).click();
    await d.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
    await p.getByRole("button", { name: "全选", exact: true }).click();
    await p.getByRole("button", { name: "添加模型", exact: true }).click();
    await d.getByRole("button", { name: "保存", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    assert.equal(
      await p.evaluate(
        () =>
          window.__creativeRequestFixture.requests.filter(
            (r) => r.method === "POST",
          ).length,
      ),
      0,
    );
    checks.push("saving configuration never auto-submits");
    // Submit the retained sidebar draft with a configured text model.
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["POST /v1/chat/completions"] = {
        body: {
          choices: [
            { message: { content: "配置已生效" }, finish_reason: "stop" },
          ],
        },
      };
    });
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p
      .getByRole("button", { name: "选择模型", exact: true })
      .last()
      .click();
    await p.locator(".model-selector__search input").fill("gpt-4o");
    await p.locator(".model-selector__item").first().click();
    await p.getByRole("button", { name: "发送文本消息", exact: true }).click();
    await p.getByText("配置已生效", { exact: true }).last().waitFor();
    assert.equal(await d.count(), 0);
    checks.push("configured text send succeeds using synthetic response");
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p.getByRole("button", { name: "直接生成", exact: true }).click();
    await p.locator(".generation-type-dropdown__trigger").click();
    await p
      .locator(".generation-type-dropdown__item")
      .filter({ hasText: "图片" })
      .click();
    await p.locator(".model-dropdown__trigger:visible").first().click();
    await p
      .getByPlaceholder("搜索模型名 / 展示名 / 供应商")
      .fill("gpt-image-2");
    await p.getByText("gpt-image-2", { exact: true }).last().click();
    await p.getByTestId("ai-input-textarea").fill("合成图片测试");
    await p.locator(".ai-input-bar__send-btn").click();
    await p.waitForFunction(() =>
      window.__creativeRequestFixture.requests.some(
        (r) => r.method === "POST" && r.path === "/v1/images/generations",
      ),
    );
    assert.equal(await d.count(), 0);
    checks.push("configured image generation passes gate");
    await p.screenshot({ path: output + "/" + engine + "-configured.png" });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      output + "/" + engine + "-flow.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(engine, checks.length, "checks passed");
  } catch (e) {
    await p.screenshot({ path: output + "/" + engine + "-failure.png" });
    throw e;
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
