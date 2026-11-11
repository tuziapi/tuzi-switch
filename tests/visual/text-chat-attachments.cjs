// Real compiled chat, settings, canvas and IndexedDB; only provider HTTP is synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.TEXT_CHAT_BROWSER || "chromium";
const output = process.env.TEXT_CHAT_OUTPUT || "/tmp/tuzi-text-attachments-qa";
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
    await until(
      async () =>
        p.evaluate(() => {
          const trigger = document
            .querySelector(".text-chat-header .model-selector__trigger")
            .getBoundingClientRect();
          const menu = document
            .querySelector(".model-selector__dropdown")
            .getBoundingClientRect();
          const root = document
            .querySelector(".creative-root")
            .getBoundingClientRect();
          const gap = Math.min(
            Math.abs(menu.top - trigger.bottom - 8),
            Math.abs(trigger.top - menu.bottom - 8),
          );
          return (
            gap < 2 &&
            menu.left >= root.left &&
            menu.right <= root.right &&
            menu.top >= root.top &&
            menu.bottom <= root.bottom
          );
        }),
      "model menu must stay anchored inside embedded bounds",
    );
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
    await p.goto(base);
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["GET /v1/models"] = {
        body: {
          data: [
            "gpt-4o",
            "claude-sonnet-4-5",
            "deepseek-chat",
            "gemini-2.5-flash",
            ...Array.from(
              { length: 14 },
              (_, index) => `gpt-5-qa-${index + 1}`,
            ),
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
    assert.equal(
      await p
        .getByRole("button", { name: "对话", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await choose("gpt-4o");

    const upload = (files) =>
      p.getByLabel("选择聊天附件", { exact: true }).setInputFiles(files);
    const count = async (n) =>
      until(
        async () =>
          (await p
            .locator(".text-chat-composer .text-chat-attachment")
            .count()) === n,
        "attachment count " + n,
      );
    const txt = {
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Synthetic attachment\nconst value = 42;\n中文可读取",
      ),
    };
    const png = {
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDasAAAAASUVORK5CYII=",
        "base64",
      ),
    };
    function pdf(text) {
      const cjk = /[^\x00-\x7F]/.test(text);
      const operand = cjk
        ? "<" + Buffer.from(text, "utf16le").swap16().toString("hex") + ">"
        : "(" + text + ")";
      const content = text ? `BT /F1 12 Tf 50 700 Td ${operand} Tj ET` : "";
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        cjk
          ? "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>"
          : "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ];
      if (cjk)
        objects.push(
          "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>",
        );
      let data = "%PDF-1.4\n",
        offsets = [0];
      objects.forEach((v, i) => {
        offsets.push(Buffer.byteLength(data));
        data += `${i + 1} 0 obj\n${v}\nendobj\n`;
      });
      const xref = Buffer.byteLength(data);
      data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return {
        name: text ? "notes.pdf" : "scan.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(data),
      };
    }
    // Native WebKit can lack new ECMAScript helpers despite modern browser tests.
    await p.evaluate(() => {
      delete ReadableStream.prototype[Symbol.asyncIterator];
      delete Map.prototype.getOrInsertComputed;
      delete WeakMap.prototype.getOrInsertComputed;
      delete Uint8Array.prototype.toBase64;
      delete Uint8Array.fromBase64;
    });
    await upload([txt, png, pdf("Synthetic PDF extracted text")]);
    await count(3);
    await until(
      async () =>
        await p.getByLabel("发送文本消息", { exact: true }).isEnabled(),
      "attachment-only enabled",
    );
    await p.getByLabel("预览附件 notes.pdf", { exact: true }).click();
    await p
      .getByRole("dialog", { name: "附件预览 notes.pdf" })
      .getByText(/Synthetic PDF extracted text/)
      .waitFor();
    await p.keyboard.press("Escape");
    assert.equal(await p.getByTestId("text-chat-workspace").isVisible(), true);
    await p.getByLabel("预览附件 sample.png", { exact: true }).click();
    await until(
      async () =>
        p
          .locator(".text-chat-attachment-preview img")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      "image decoded",
    );
    await p.getByLabel("关闭附件预览", { exact: true }).click();
    checks.push(
      "real PDF worker extraction, UTF-8 and image compression/preview; Escape preserves workspace",
    );
    const saved = await records(p, "aitu-chat", "sessions");
    assert(!JSON.stringify(saved).includes("base64,"));
    assert(!JSON.stringify(saved).includes("Synthetic PDF extracted text"));
    const payloads = await records(p, "aitu-chat", "text_attachments");
    assert.equal(payloads.length, 3);
    assert(
      payloads.some((a) => a.dataUrl?.startsWith("data:image/jpeg;base64,")),
    );
    await shot("draft-light");
    await p.reload();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await count(3);
    checks.push("draft survives reload; session snapshots contain refs only");
    await mock("Synthetic attachment accepted");
    await p.getByLabel("发送文本消息", { exact: true }).click();
    await complete(1);
    const requests = await p.evaluate(
      () => window.__creativeRequestFixture.requests,
    );
    const posted = requests.filter((r) => r.method === "POST").at(-1);
    const body =
      typeof posted.body === "string"
        ? JSON.parse(Buffer.from(posted.body, "base64").toString("utf8"))
        : posted.body;
    assert(
      body.messages
        .at(-1)
        .content.some(
          (c) =>
            c.type === "image_url" &&
            c.image_url.url.startsWith("data:image/jpeg;base64,"),
        ),
    );
    assert(
      body.messages
        .at(-1)
        .content.some(
          (c) =>
            c.text?.includes("Synthetic PDF extracted text") &&
            c.text.includes("const value = 42"),
        ),
    );
    await p.getByLabel("预览附件 notes.pdf", { exact: true }).click();
    const rect = await p
      .getByRole("dialog", { name: "附件预览 notes.pdf" })
      .boundingBox();
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= 1361 &&
        rect.y + rect.height <= 901,
    );
    await p.getByLabel("关闭附件预览", { exact: true }).click();
    checks.push(
      "attachment-only request includes extracted documents and encoded image; virtual row preview stays in viewport",
    );
    await upload([
      {
        name: "bad.txt",
        mimeType: "text/plain",
        buffer: Buffer.from([0, 1, 2]),
      },
    ]);
    await p.getByText(/文件包含二进制内容/).waitFor();
    await upload([
      {
        name: "bad.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not PDF"),
      },
    ]);
    await p.getByText(/PDF 已损坏/).waitFor();
    await upload([pdf("")]);
    await p.getByText(/文件没有可读取的文字/).waitFor();
    assert.equal(
      await p.locator(".text-chat-composer .text-chat-attachment").count(),
      0,
    );
    checks.push(
      "binary, malformed PDF and scanned/empty PDF have explicit errors",
    );
    await upload([pdf("中文附件读取")]);
    await count(1);
    await p
      .locator(".text-chat-composer")
      .getByLabel("预览附件 notes.pdf", { exact: true })
      .click();
    await p
      .getByRole("dialog", { name: "附件预览 notes.pdf" })
      .getByText(/中文附件读取/)
      .waitFor();
    await p.getByLabel("关闭附件预览", { exact: true }).click();
    await p
      .locator(".text-chat-composer")
      .getByLabel("移除附件 notes.pdf", { exact: true })
      .click();
    await count(0);
    checks.push(
      "Chinese PDF with nonembedded CJK character map extracts offline",
    );
    await p.locator(".text-chat-main").evaluate((el, bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "dropped.ts", { type: "text/plain" }));
      el.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    }, "// synthetic drop");
    await count(1);
    await p.getByLabel("移除附件 dropped.ts", { exact: true }).click();
    await count(0);
    await p.getByLabel("文本消息", { exact: true }).evaluate((el, base64) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(
          [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
          "pasted.png",
          { type: "image/png" },
        ),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
    }, png.buffer.toString("base64"));
    await count(1);
    await p.getByLabel("移除附件 pasted.png", { exact: true }).click();
    await count(0);
    await until(
      async () =>
        (await records(p, "aitu-chat", "text_attachments")).length === 3,
      "draft payload cleanup",
    );
    checks.push(
      "drop and paste import attachments; removal deletes draft payloads",
    );
    await upload([txt]);
    await count(1);
    await p.evaluate(() => {
      window.__creativeRequestFixture.responses["POST /v1/chat/completions"] = {
        status: 429,
        body: { error: { message: "Synthetic rate limit" } },
      };
    });
    await p.getByLabel("发送文本消息", { exact: true }).click();
    await until(
      async () =>
        (await p.locator('.text-chat-answer[data-status="error"]').count()) ===
        1,
      "failed request",
    );
    await upload([{ ...txt, name: "next.md" }]);
    await count(1);
    await p.getByLabel("文本消息", { exact: true }).fill("keep unsent draft");
    await mock("Synthetic retry accepted");
    await p.getByRole("button", { name: "重试", exact: true }).last().click();
    await complete(2);
    assert.equal(
      await p.getByLabel("文本消息", { exact: true }).inputValue(),
      "keep unsent draft",
    );
    await count(1);
    checks.push(
      "failed send retains attachments; explicit retry preserves a different draft",
    );
    await p.evaluate(() => document.documentElement.classList.add("dark"));
    await p.setViewportSize({ width: 980, height: 760 });
    await until(
      async () =>
        p
          .locator(".text-chat-composer .text-chat-attachment")
          .evaluate(
            (el) => getComputedStyle(el).backgroundColor === "rgb(38, 44, 36)",
          ),
      "dark attachment card background",
    );
    await shot("narrow-dark");
    const overflow = await p
      .getByTestId("text-chat-workspace")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 2);
    assert.equal(overflow, false);
    await p.reload();
    await p.getByLabel("文本消息", { exact: true }).waitFor();
    await count(1);
    assert.equal((await records(p, "aitu-chat", "text_attachments")).length, 5);
    checks.push("narrow/dark layout and sent/draft payload recovery");
    await p.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        return this.name === "slow.txt"
          ? new Promise((resolve, reject) =>
              setTimeout(() => read.call(this).then(resolve, reject), 1500),
            )
          : read.call(this);
      };
    });
    await upload([
      {
        name: "slow.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("synthetic slow read"),
      },
    ]);
    await p.getByRole("button", { name: "新建文本对话", exact: true }).click();
    await count(0);
    await p.waitForTimeout(1700);
    assert.equal((await records(p, "aitu-chat", "text_attachments")).length, 5);
    assert.equal(
      await p.getByLabel("文本消息", { exact: true }).inputValue(),
      "",
    );
    checks.push(
      "switching during preparation cancels without cross-session attachment or orphan payload",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, `${engine}-results.json`),
      JSON.stringify(
        { checks, requests: "synthetic only", pageErrors: errors },
        null,
        2,
      ),
    );
    console.log(engine, checks.length, "checks passed");
  } catch (e) {
    await shot("failure");
    console.error(e);
    console.error((await p.locator("body").innerText()).slice(-6000));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
