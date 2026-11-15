// Local synthetic profiles only. Run serially on the same machine for before/after comparisons.
const { chromium, webkit } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const fs = require("node:fs");
const assert = require("node:assert/strict");
const engine = process.env.TEXT_CHAT_BROWSER || "chromium";
const output = process.env.TEXT_PERF_OUTPUT || "/tmp/tuzi-text-perf";
const sessionCount = Number(process.env.TEXT_PERF_SESSIONS || 300);
const messageCount = Number(process.env.TEXT_PERF_MESSAGES || 800);
const cpu = Number(process.env.TEXT_PERF_CPU || 1);
const sample =
  '### 本地性能测试\n\n这是合成对话，用于观察长会话的渲染开销。**保持界面响应**，并保留完整历史。\n\n- 复用已有设置\n- 保留每条消息\n- 及时保存草稿\n\n```typescript\nconst message = "synthetic";\nconsole.log(message);\n```\n\n公式 $E=mc^2$。\n\n' +
  "用于测量文本解析和滚动。".repeat(24);
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ] || 0;
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
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  await ctx.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1" ||
    /^(data:|blob:)/.test(r.request().url())
      ? r.continue()
      : r.abort(),
  );
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  if (engine === "chromium") {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  }
  await p.addInitScript(() => {
    window.__textPerf = {
      frames: [],
      long: [],
      input: [],
      puts: 0,
      putMs: [],
      mutations: 0,
    };
    let prev = 0;
    function frame(t) {
      if (prev) window.__textPerf.frames.push(t - prev);
      prev = t;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
      new PerformanceObserver((list) =>
        window.__textPerf.long.push(
          ...list.getEntries().map((e) => e.duration),
        ),
      ).observe({ type: "longtask" });
    document.addEventListener(
      "input",
      () => {
        const start = performance.now();
        requestAnimationFrame(() =>
          window.__textPerf.input.push(performance.now() - start),
        );
      },
      true,
    );
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const start = performance.now();
      const result = put.apply(this, args);
      if (this.transaction.db.name === "aitu-chat") {
        window.__textPerf.puts++;
        window.__textPerf.putMs.push(performance.now() - start);
      }
      return result;
    };
  });
  try {
    await p.goto("http://127.0.0.1:5211/ui04.html?canvas=1&page=creative");
    await p.evaluate(
      () =>
        (window.__creativeRequestFixture.responses["GET /v1/models"] = {
          body: {
            data: [
              {
                id: "gpt-4o",
                supported_endpoint_types: ["openai"],
                endpoints: {
                  openai: { path: "/v1/chat/completions", method: "POST" },
                },
              },
            ],
          },
        }),
    );
    await p.getByRole("button", { name: "创作配置", exact: true }).click();
    const dialog = p.getByTestId("settings-dialog");
    await dialog.getByRole("button", { name: "手动配置", exact: true }).click();
    await dialog.locator("input[type=password]").fill("sk-SYNTHETIC-PERF");
    await dialog
      .locator(".settings-dialog__field")
      .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
      .locator("input")
      .first()
      .fill("https://creative.synthetic.invalid/v1");
    await dialog.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
    await p.getByRole("button", { name: "全选", exact: true }).click();
    await p.getByRole("button", { name: "添加模型", exact: true }).click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await p.getByRole("button", { name: "自由画布", exact: true }).click();
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await p.locator(".text-chat-header .model-selector__trigger").click();
    await p
      .locator(".model-selector__item")
      .filter({ hasText: "gpt-4o" })
      .click();
    await p.waitForTimeout(800);
    await p.evaluate(
      async ({ sessionCount, messageCount, sample }) => {
        const request = indexedDB.open("aitu-chat");
        const db = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const existing = await new Promise((resolve) => {
          const r = db.transaction("sessions").objectStore("sessions").getAll();
          r.onsuccess = () => resolve(r.result);
        });
        const modelRef = existing.find(
          (s) => s.kind === "text",
        ).sessionModelRef;
        const tx = db.transaction("sessions", "readwrite");
        const store = tx.objectStore("sessions");
        const now = Date.now();
        for (let s = 0; s < sessionCount; s++) {
          const id = "synthetic-perf-" + s;
          const messages = Array.from(
            { length: s === 0 ? messageCount : 4 },
            (_, m) => ({
              id: id + "-m" + m,
              role: m % 2 ? "assistant" : "user",
              content: m % 2 ? sample : "合成问题 " + m,
              reasoning: "",
              status: "complete",
              createdAt: now + m,
              replyTo: m % 2 ? id + "-m" + (m - 1) : undefined,
              model: "gpt-4o",
            }),
          );
          store.put(
            {
              id,
              kind: "text",
              title: s === 0 ? "性能压力长会话" : "性能会话 " + s,
              createdAt: now - s * 1000,
              updatedAt: now - s * 1000,
              messageCount: messages.length,
              sessionModel: "gpt-4o",
              sessionModelRef: modelRef,
              textChat: { version: 1, messages, draft: "", systemPrompt: "" },
            },
            id,
          );
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        localStorage.setItem(
          "aitu:chat:drawer-state",
          JSON.stringify({
            isOpen: false,
            mode: "text",
            textFocus: true,
            textActiveSessionId: "synthetic-perf-0",
          }),
        );
      },
      { sessionCount, messageCount, sample },
    );
    await p.reload();
    await p.getByRole("button", { name: "对话", exact: true }).waitFor();
    const reset = () =>
      p.evaluate(() => {
        const m = window.__textPerf;
        Object.keys(m).forEach((k) => (m[k] = Array.isArray(m[k]) ? [] : 0));
      });
    const collect = () =>
      p.evaluate(() => ({
        ...window.__textPerf,
        nodes: document.querySelectorAll(".text-chat-workspace *").length,
        answers: document.querySelectorAll(".text-chat-answer").length,
        heap: performance.memory?.usedJSHeapSize,
      }));
    const settled = () =>
      p.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
    await reset();
    const t0 = await p.evaluate(() => performance.now());
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p
      .locator(`[data-message-id="synthetic-perf-0-m${messageCount - 1}"]`)
      .waitFor();
    await settled();
    const openMs = await p.evaluate((t) => performance.now() - t, t0);
    const opening = await collect();
    await p
      .getByLabel("文本消息", { exact: true })
      .pressSequentially("测试输入响应：长对话中逐字编辑草稿，检查是否卡顿。", {
        delay: 20,
      });
    await settled();
    const typing = await collect();
    console.log("typing complete", openMs);
    await reset();
    for (let i = 0; i < 12; i++) {
      await p
        .locator(".text-chat-scroll")
        .evaluate((el, i) => (el.scrollTop = i % 2 ? el.scrollHeight : 0), i);
      await p.waitForTimeout(80);
    }
    await settled();
    const scrolling = await collect();
    console.log("scrolling complete");
    await p.evaluate(() => {
      const event = (o) => "data: " + JSON.stringify(o) + "\n\n";
      window.__creativeRequestFixture.responses["POST /v1/chat/completions"] = {
        body: "",
        contentType: "text/event-stream",
        delayMs: 20,
        chunks: [
          ...Array.from({ length: 160 }, (_, i) =>
            event({
              choices: [
                { delta: { content: "流式片段 " + i + " **保持响应**。\n\n" } },
              ],
            }),
          ),
          event({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          "data: [DONE]\n\n",
        ],
      };
    });
    await p.getByLabel("文本消息", { exact: true }).fill("合成流式性能测试");
    await reset();
    await p.getByLabel("发送文本消息", { exact: true }).click();
    await p.getByLabel("停止回复", { exact: true }).waitFor();
    await p
      .getByLabel("停止回复", { exact: true })
      .waitFor({ state: "hidden", timeout: 30000 });
    await settled();
    const streaming = await collect();
    await p.waitForFunction(() => {
      const el = document.querySelector(".text-chat-scroll");
      return el.scrollHeight - el.scrollTop - el.clientHeight < 75;
    });
    await p.getByLabel("新建文本对话", { exact: true }).click();
    await p
      .locator(".text-chat-title button")
      .filter({ hasText: /^新对话$/ })
      .waitFor();
    await p.getByLabel("文本消息", { exact: true }).fill("后台合成流式测试");
    await p.getByLabel("发送文本消息", { exact: true }).click();
    await p.getByLabel("停止回复", { exact: true }).waitFor();
    await p.getByRole("button", { name: "性能会话 1", exact: true }).click();
    await reset();
    await p.evaluate(() => {
      const observer = new MutationObserver(
        (entries) => (window.__textPerf.mutations += entries.length),
      );
      observer.observe(document.querySelector(".text-chat-main"), {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
    await p
      .getByLabel("文本消息", { exact: true })
      .pressSequentially("后台回复时，当前短会话应保持流畅。", { delay: 30 });
    await p.waitForTimeout(3800);
    const background = await collect();
    const summarize = (m) => ({
      nodes: m.nodes,
      answers: m.answers,
      heap: m.heap,
      frameP95: percentile(m.frames, 0.95),
      frameMax: Math.max(0, ...m.frames),
      framesOver50: m.frames.filter((x) => x > 50).length,
      longTasks: m.long.length,
      longTaskMax: Math.max(0, ...m.long),
      inputP95: percentile(m.input, 0.95),
      puts: m.puts,
      putSyncMax: Math.max(0, ...m.putMs),
      mainMutations: m.mutations,
    });
    const result = {
      engine,
      cpu,
      sessionCount,
      messageCount,
      openMs,
      opening: summarize(opening),
      typing: summarize(typing),
      scrolling: summarize(scrolling),
      streaming: summarize(streaming),
      background: summarize(background),
      errors,
    };
    // Keep correctness checks after the comparable measurement windows.
    const checks = ["streaming continues following the latest reply"];
    assert.ok(
      opening.answers < 30,
      "long history mounts a bounded message window",
    );
    await p
      .getByRole("button", { name: "性能压力长会话", exact: true })
      .click();
    const scroll = p.locator(".text-chat-scroll");
    const first = p.locator('[data-message-id="synthetic-perf-0-m0"]');
    await scroll.evaluate((el) => (el.scrollTop = 0));
    await first.waitFor();
    assert.equal(await first.innerText(), "合成问题 0");
    await p.getByRole("button", { name: "回到最新回复", exact: true }).click();
    await p.waitForFunction(() => {
      const el = document.querySelector(".text-chat-scroll");
      return el.scrollHeight - el.scrollTop - el.clientHeight < 75;
    });
    checks.push("virtual history: first message and return to latest");
    await p.getByLabel("文本消息", { exact: true }).fill("虚拟滚动与收起回归");
    await p.getByLabel("发送文本消息", { exact: true }).click();
    await p.getByLabel("停止回复", { exact: true }).waitFor();
    await p.waitForTimeout(150);
    await scroll.evaluate((el) => (el.scrollTop = 0));
    await first.waitFor();
    await p.waitForTimeout(650);
    assert.ok(
      (await scroll.evaluate((el) => el.scrollTop)) < 100,
      "stream must not steal old-message scroll position",
    );
    checks.push("reading old messages during streaming does not jump");
    await p.getByRole("button", { name: "画布并排", exact: true }).click();
    await p.waitForTimeout(250);
    await first.waitFor();
    await p.getByRole("button", { name: "专注对话", exact: true }).click();
    await p.waitForTimeout(250);
    await first.waitFor();
    await p.getByRole("button", { name: "回到最新回复", exact: true }).click();
    await p.waitForFunction(() => {
      const el = document.querySelector(".text-chat-scroll");
      return el.scrollHeight - el.scrollTop - el.clientHeight < 75;
    });
    checks.push("variable height remeasurement across side-by-side/focus");
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p.locator(".text-chat-workspace").waitFor({ state: "detached" });
    await p.waitForTimeout(3800);
    assert.equal(await p.locator(".text-chat-workspace").count(), 0);
    await p.getByRole("button", { name: "对话", exact: true }).click();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await p
      .getByLabel("停止回复", { exact: true })
      .waitFor({ state: "hidden" });
    await p.waitForFunction(
      () =>
        document.querySelector(".text-chat-answer:last-child") ||
        document.querySelector(".text-chat-answer"),
    );
    const saved = await p.evaluate(async () => {
      const r = indexedDB.open("aitu-chat");
      const db = await new Promise(
        (resolve) => (r.onsuccess = () => resolve(r.result)),
      );
      const read = db
        .transaction("sessions")
        .objectStore("sessions")
        .get("synthetic-perf-0");
      const record = await new Promise(
        (resolve) => (read.onsuccess = () => resolve(read.result)),
      );
      db.close();
      return {
        count: record.textChat.messages.length,
        first: record.textChat.messages[0].content,
        last: record.textChat.messages.at(-1),
      };
    });
    assert.equal(saved.count, messageCount + 4);
    assert.equal(saved.first, "合成问题 0");
    assert.equal(saved.last.status, "complete");
    assert.ok(saved.last.content.includes("流式片段 159"));
    checks.push(
      "hidden chat unmounts DOM while full background reply persists",
    );
    await p.reload();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await p.waitForFunction(() =>
      Array.from(document.querySelectorAll(".text-chat-answer")).some((el) =>
        el.textContent.includes("流式片段 159"),
      ),
    );
    await p.locator(".text-chat-scroll").evaluate((el) => (el.scrollTop = 0));
    await p.locator('[data-message-id="synthetic-perf-0-m0"]').waitFor();
    checks.push("full long history and hidden reply survive reload");
    result.correctness = checks;
    fs.writeFileSync(
      output + "/" + engine + "-performance.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
  } catch (e) {
    await p.screenshot({ path: output + "/failure.png" });
    fs.writeFileSync(
      output + "/failure.txt",
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
