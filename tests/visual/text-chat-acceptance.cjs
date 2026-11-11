// Real compiled chat, settings, canvas and IndexedDB; only provider HTTP is synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.TEXT_CHAT_BROWSER || "chromium";
const output = process.env.TEXT_CHAT_OUTPUT || "/tmp/tuzi-text-chat-qa";
const base =
  process.env.TEXT_CHAT_URL ||
  "http://127.0.0.1:5211/ui04.html?canvas=1&page=creative";
fs.mkdirSync(output, { recursive: true });
const answer =
  '## 把想法变成清晰的下一步\n\n我们可以从三个方向开始：\n\n1. **明确目标**：你希望为谁解决什么问题？\n2. **拆解行动**：先完成一个能验证想法的小版本。\n3. **收集反馈**：根据真实使用情况调整。\n\n```typescript\nconst idea = "从一个想法开始";\nconsole.log(idea);\n```\n\n一个简单公式：$E = mc^2$。';
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const checks = [];
async function records(p, db, store) {
  return p.evaluate(
    ({ db, store }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(db);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const d = req.result;
          const get = d.transaction(store).objectStore(store).getAll();
          get.onsuccess = () => {
            resolve(get.result);
            d.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
    { db, store },
  );
}
async function until(fn, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(label);
}
(async () => {
  const browser = await playwright[engine].launch({
    headless: true,
    ...(engine === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await ctx.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1" ||
    /^(blob:|data:)/.test(r.request().url())
      ? r.continue()
      : r.abort(),
  );
  const shot = async (name) => {
    await p.screenshot({ path: path.join(output, `${engine}-${name}.png`) });
  };
  async function checkModelMenu() {
    await until(async () => p.evaluate(() => {
      const trigger = document.querySelector('.text-chat-header .model-selector__trigger').getBoundingClientRect();
      const menu = document.querySelector('.model-selector__dropdown').getBoundingClientRect();
      const root = document.querySelector('.creative-root').getBoundingClientRect();
      const gap = Math.min(Math.abs(menu.top - trigger.bottom - 8), Math.abs(trigger.top - menu.bottom - 8));
      return gap < 2 && menu.left >= root.left && menu.right <= root.right && menu.top >= root.top && menu.bottom <= root.bottom;
    }), 'model menu must stay anchored inside embedded bounds');
  }
  async function choose(model) {
    await p.locator(".text-chat-header .model-selector__trigger").click();
    await p.locator(".model-selector__dropdown input").fill(model);
    await p
      .locator(".model-selector__item")
      .filter({ hasText: new RegExp(model, "i") })
      .first()
      .click();
  }
  async function mock(text = answer, slow = false) {
    await p.evaluate(
      ({ text, slow }) => {
        const event = (x) => "data: " + JSON.stringify(x) + "\n\n";
        window.__creativeRequestFixture.responses["POST /v1/chat/completions"] =
          {
            body: "",
            contentType: "text/event-stream",
            delayMs: slow ? 1200 : 30,
            chunks: [
              event({
                choices: [
                  {
                    delta: {
                      reasoning_content: "先明确目标，再组织可执行步骤。",
                    },
                  },
                ],
              }),
              event({ choices: [{ delta: { content: text } }] }),
              event({ choices: [{ delta: {}, finish_reason: "stop" }] }),
              event({
                choices: [],
                usage: { prompt_tokens: 35, completion_tokens: 62 },
              }),
              "data: [DONE]\n\n",
            ],
          };
      },
      { text, slow },
    );
  }
  async function send(text) {
    await p.getByLabel("文本消息", { exact: true }).fill(text);
    await p.getByLabel("发送文本消息", { exact: true }).click();
  }
  async function complete(count) {
    await until(
      async () =>
        (await p
          .locator('.text-chat-answer[data-status="complete"]')
          .count()) === count,
      "reply not complete",
    );
  }
  try {
    await p.addInitScript(() => {
      if (!localStorage.getItem('aitu:chat:drawer-state')) {
        localStorage.setItem('aitu:chat:drawer-state', JSON.stringify({ mode: 'creative', isOpen: false, textFocus: true }));
      }
    });
    await p.goto(base);
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["GET /v1/models"] = {
        body: {
          data: [
            "gpt-4o",
            "claude-sonnet-4-5",
            "deepseek-chat",
            "gemini-2.5-flash",
            ...Array.from({length: 14}, (_, index) => `gpt-5-qa-${index + 1}`),
          ].map((id) => ({
            id,
            object: "model",
            supported_endpoint_types: ["openai"],
            endpoints: {
              openai: { path: "/v1/chat/completions", method: "POST" },
            },
          })),
        },
      };
    });
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    const d = p.getByTestId("settings-dialog");
    await d.getByRole("button", { name: "手动配置", exact: true }).click();
    await d.locator("input[type=password]").fill("sk-SYNTHETIC-TEXT");
    await d
      .locator(".settings-dialog__field")
      .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
      .locator("input")
      .first()
      .fill("https://creative.synthetic.invalid/v1");
    await d.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
    await p.getByRole("button", { name: "全选", exact: true }).click();
    await p.getByRole("button", { name: "添加模型", exact: true }).click();
    await d.getByRole("button", { name: "保存", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    await p
      .getByRole("navigation", { name: "创作导航" })
      .getByRole("button", { name: "自由画布", exact: true })
      .click();
    await p.locator(".plait-board-container").waitFor();
    if (await p.getByText("不再提示", { exact: true }).isVisible())
      await p.getByText("不再提示", { exact: true }).click();
    await p.getByRole("button", { name: "对话", exact: true }).click();
    assert.equal(await p.getByRole('button', {name:'对话', exact:true}).getAttribute('aria-expanded'), 'true');
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await choose("gpt-4o");
    const history = p.getByRole('complementary', {name:'文本历史会话'});
    assert.equal(await history.isVisible(), true);
    await p.getByLabel('文本会话列表', {exact:true}).click();
    assert.equal(await history.isVisible(), false);
    assert.equal(await p.getByLabel('文本会话列表', {exact:true}).getAttribute('aria-expanded'), 'false');
    await shot('history-collapsed');
    await p.getByLabel('文本会话列表', {exact:true}).click();
    assert.equal(await history.isVisible(), true);
    await p.getByLabel('收起会话侧栏', {exact:true}).click();
    assert.equal(await history.isVisible(), false);
    await p.getByLabel('文本会话列表', {exact:true}).click();
    await p.getByRole('button', {name:'对话', exact:true}).click();
    await p.getByTestId('text-chat-workspace').waitFor({state:'hidden'});
    await p.getByRole('button', {name:'对话', exact:true}).click();
    await p.getByLabel('文本消息', {exact:true}).waitFor();
    checks.push('header toggle opens/closes the same drawer; focus history collapses in one click');
    await p.locator('.text-chat-header .model-selector__trigger').click();
    await checkModelMenu();
    await shot('model-anchored');
    await p.locator('.model-selector__item').last().scrollIntoViewIfNeeded();
    await p.locator('.model-selector__item').last().click();
    await choose('gpt-4o');
    await p.setViewportSize({width:700,height:600});
    await p.locator('.text-chat-header .model-selector__trigger').click();
    await checkModelMenu();
    await shot('model-compact');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.model-selector__dropdown').count(),0);
    await p.getByLabel('文本会话列表', {exact:true}).click();
    assert.equal(await history.isVisible(),true);
    await p.keyboard.press('Escape');
    await history.waitFor({state:'hidden'});
    await p.setViewportSize({width:1360,height:900});
    checks.push('model menu anchors to its trigger, stays in workspace bounds and scrolls; compact overlay dismisses');
    await shot("empty");
    assert.equal(await p.locator(".unified-toolbar").isVisible(), false);
    checks.push("focus hides canvas toolbar and handle");
    await p.locator(".text-chat-header .model-selector__trigger").click();
    await p.locator(".model-selector__dropdown input").fill("deepseek");
    assert.equal(await p.locator(".model-selector__item").count(), 1);
    await shot("models");
    await p.locator(".model-selector__item").click();
    checks.push("configured model catalogue and search reused");
    await p
      .getByLabel("文本消息", { exact: true })
      .fill("还没发送的第一条草稿");
    await until(
      async () =>
        (await records(p, "aitu-chat", "sessions")).some(
          (s) => s.textChat?.draft === "还没发送的第一条草稿",
        ),
      "first draft not persisted",
    );
    await p.reload();
    await p
      .getByRole("navigation", { name: "创作导航" })
      .getByRole("button", { name: "自由画布", exact: true })
      .click();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await until(
      async () =>
        (await p.getByLabel("文本消息", { exact: true }).inputValue()) ===
        "还没发送的第一条草稿",
      "draft restoration did not finish",
    );
    await p
      .getByLabel("文本消息", { exact: true })
      .dispatchEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      });
    await p
      .getByLabel("文本消息", { exact: true })
      .dispatchEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
    assert.equal(
      await p.evaluate(
        () =>
          window.__creativeRequestFixture.requests.filter(
            (r) => r.method === "POST",
          ).length,
      ),
      0,
    );
    checks.push(
      "initial unsent draft survives reload; IME confirmation does not submit",
    );
    await mock();
    await send("帮我把一个新产品的想法整理成可执行的计划。");
    await complete(1);
    assert.equal(await p.locator(".katex").count(), 1);
    assert(
      await p
        .locator(".text-chat-answer")
        .innerText()
        .then((x) => x.includes("62 输出 tokens")),
    );
    await p.locator(".text-chat-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await shot("focus");
    checks.push("streaming, reasoning, Markdown, code, math, final usage");
    const a = (await records(p, "aitu-chat", "sessions")).find(
      (s) => s.kind === "text",
    );
    assert(a);
    assert.equal(a.sessionModel, "deepseek-chat");
    await p.getByLabel("文本消息", { exact: true }).fill("尚未发送的草稿");
    await until(
      async () =>
        (await records(p, "aitu-chat", "sessions")).find((s) => s.id === a.id)
          ?.textChat.draft === "尚未发送的草稿",
      "draft not saved",
    );
    await p.reload();
    await p
      .getByRole("navigation", { name: "创作导航" })
      .getByRole("button", { name: "自由画布", exact: true })
      .click();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await until(
      async () =>
        (await p.getByLabel("文本消息", { exact: true }).inputValue()) ===
        "尚未发送的草稿",
      "draft restoration did not finish",
    );
    await complete(1);
    checks.push("conversation, model and draft restored after reload");
    await mock("第二轮回复");
    await send("继续细化");
    await complete(2);
    const reqs = await p.evaluate(
      () => window.__creativeRequestFixture.requests,
    );
    const body = JSON.parse(
      Buffer.from(
        reqs.filter((r) => r.method === "POST").at(-1).body,
        "base64",
      ).toString(),
    );
    assert.deepEqual(
      body.messages.map((m) => m.role),
      ["user", "assistant", "user"],
    );
    checks.push("follow-up carries complete history");
    await p
      .getByRole("button", { name: "重新生成", exact: true })
      .first()
      .click();
    await complete(3);
    const regen = await p.evaluate(() =>
      window.__creativeRequestFixture.requests
        .filter((r) => r.method === "POST")
        .at(-1),
    );
    assert.equal(
      JSON.parse(Buffer.from(regen.body, "base64").toString()).messages.length,
      1,
    );
    checks.push("regeneration retains replies and excludes later user turns");
    await p
      .getByRole("button", { name: "插入画布", exact: true })
      .last()
      .click();
    await p.getByLabel("专注对话", { exact: true }).waitFor();
    await until(
      async () =>
        JSON.stringify(await records(p, "aitu-workspace", "boards")).includes(
          "第二轮回复",
        ),
      "canvas insertion not persisted",
    );
    await p.locator('.text-chat-header .model-selector__trigger').click();
    await checkModelMenu();
    await shot('model-side');
    await p.keyboard.press('Escape');
    await p.getByLabel('文本会话列表', {exact:true}).click();
    await history.getByRole('button', {name:await p.locator('.text-chat-title button').innerText(),exact:true}).click();
    assert.equal(await history.isVisible(),false);
    await p.getByRole('button', {name:'对话',exact:true}).click();
    await p.getByTestId('text-chat-workspace').waitFor({state:'hidden'});
    await p.getByRole('button', {name:'对话',exact:true}).click();
    await p.getByLabel('文本消息',{exact:true}).waitFor();
    await shot("side");
    checks.push("explicit insertion persists text in canvas and exits focus");
    await p.getByLabel("专注对话", { exact: true }).click();
    await p.getByLabel("新建文本对话", { exact: true }).click();
    await choose("claude-sonnet");
    await mock("A 会话的部分回复", true);
    await send("并发会话 A");
    await until(
      async () =>
        await p
          .locator(".text-chat-answer")
          .innerText()
          .then((t) => t.includes("A 会话的部分回复")),
      "partial text absent",
    );
    await p.getByLabel("新建文本对话", { exact: true }).click();
    await choose("gpt-4o");
    await mock("B 会话完整回复");
    await send("并发会话 B");
    await complete(1);
    await shot('history');
    await history.getByLabel('重命名 并发会话 B', {exact:true}).click();
    await p.getByLabel('会话名称',{exact:true}).fill('整理产品计划');
    await p.getByLabel('会话名称',{exact:true}).press('Enter');
    await history.getByLabel('搜索文本对话',{exact:true}).fill('整理产品');
    assert.equal(await history.locator('.text-chat-session').count(),1);
    assert.equal(await history.getByRole('button',{name:'整理产品计划',exact:true}).count(),1);
    await history.getByLabel('搜索文本对话',{exact:true}).fill('');
    await history.getByLabel('重命名 整理产品计划',{exact:true}).click();
    await p.getByLabel('会话名称',{exact:true}).fill('并发会话 B');
    await p.getByLabel('会话名称',{exact:true}).press('Enter');
    checks.push('grouped history supports previews, inline selection, rename and search');
    await p
      .locator(".text-chat-session-list button")
      .filter({ hasText: "并发会话 A" })
      .click();
    if (await p.getByLabel("停止回复", { exact: true }).isVisible())
      await p.getByLabel("停止回复", { exact: true }).click();
    await until(
      async () =>
        (await p
          .locator('.text-chat-answer[data-status="stopped"]')
          .count()) === 1,
      "A not stopped",
    );
    assert(
      (await p.locator(".text-chat-answer").innerText()).includes(
        "A 会话的部分回复",
      ),
    );
    checks.push(
      "concurrent sessions stay independent; stop retains partial output",
    );
    await p
      .locator(".text-chat-session-list button")
      .filter({ hasText: "并发会话 B" })
      .click();
    await complete(1);
    await until(
      async () =>
        (await p.locator(".text-chat-answer").textContent()).includes(
          "B 会话完整回复",
        ),
      "B reply identity changed",
    );
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["POST /v1/chat/completions"] = {
        body: { error: { message: "synthetic quota unavailable" } },
        status: 429,
      };
    });
    await send("模拟错误");
    await until(
      async () =>
        (await p.locator('.text-chat-answer[data-status="error"]').count()) ===
        1,
      "error missing",
    );
    await mock("重试成功");
    await p.getByRole("button", { name: "重试", exact: true }).click();
    await complete(2);
    checks.push("HTTP failure preserved; retry only on explicit click");
    await p.getByLabel("当前对话设置", { exact: true }).click();
    await p.getByLabel("最大输出长度", { exact: true }).fill("512");
    await p.getByLabel("关闭对话设置", { exact: true }).click();
    await p.getByLabel("文本消息", { exact: true }).fill("独立草稿");
    assert.equal(await p.getByRole("button", { name: "创作助手", exact: true }).count(), 0);
    assert.equal(await p.locator('.text-chat-creative-body').count(), 0);
    await p.getByRole("button", { name: "关闭对话面板", exact: true }).click();
    await p.getByRole("button", { name: "对话", exact: true }).click();
    assert.equal(
      await p.getByLabel("文本消息", { exact: true }).inputValue(),
      "独立草稿",
    );
    checks.push("legacy creative conversation unmounted; side chat and draft retained");
    await p.evaluate(() =>
      document
        .querySelector(".creative-root")
        .setAttribute("data-theme", "dark"),
    );
    await until(
      async () =>
        (await p
          .locator(".text-chat-header .model-selector__trigger")
          .evaluate((el) => getComputedStyle(el).color)) ===
        "rgb(230, 233, 224)",
      "dark model text contrast",
    );
    await shot("dark");
    await p.setViewportSize({ width: 1000, height: 700 });
    await shot("compact");
    assert(await p.getByLabel("发送文本消息", { exact: true }).isVisible());
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    checks.push("dark and 1000×700 layouts");
    assert.deepEqual(errors, []);
    checks.push("no browser runtime exceptions");
    fs.writeFileSync(
      path.join(output, `${engine}-checks.json`),
      JSON.stringify(
        { engine, checks, requests: "synthetic only", errors },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ engine, checks }, null, 2));
  } catch (e) {
    await shot("failure");
    fs.writeFileSync(
      path.join(output, `${engine}-failure.txt`),
      await p.locator("body").innerText(),
    );
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
