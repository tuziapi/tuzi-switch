// Real UI/queue/storage with synthetic native transport. All external traffic is blocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const base = process.env.CREATIVE_QA_BASE_URL || "http://127.0.0.1:5217";
const out = process.env.CREATIVE_QA_OUTPUT || "/tmp/tuzi-media-acceptance";
fs.mkdirSync(out, { recursive: true });
const models = [
  { id: "MiniMax-H3", supported_endpoint_types: ["openai-video"] },
  { id: "suno/music", supported_endpoint_types: ["suno-v2"] },
  { id: "synthetic-chat", supported_endpoint_types: ["openai"] },
];
async function records(p, db, store) {
  return p.evaluate(
    ({ db, store }) =>
      new Promise((resolve, reject) => {
        const o = indexedDB.open(db);
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const d = o.result;
          const q = d.transaction(store).objectStore(store).getAll();
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
async function until(f, name, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(name);
}
async function configure(p) {
  await p.evaluate(
    (models) =>
      (window.__creativeRequestFixture.responses["GET /v1/models"] = {
        body: { data: models },
      }),
    models,
  );
  await p.getByRole("button", { name: "创作配置", exact: true }).click();
  const d = p.getByTestId("settings-dialog");
  await d.getByRole("button", { name: "兔子账户", exact: true }).click();
  await d.getByText("合成开发密钥", { exact: true }).click();
  await d.getByRole("button", { name: /^(保存并)?获取模型$/ }).click();
  await p.getByText("MiniMax-H3", { exact: true }).last().waitFor();
  await p.getByRole("button", { name: "全选", exact: true }).click();
  await p.getByText("已选 3", { exact: true }).waitFor();
  await p.getByRole("button", { name: "添加模型", exact: true }).click();
  await d.getByText("已添加 3 个", { exact: true }).waitFor();
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await d.waitFor({ state: "hidden" });
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
(async () => {
  const results = [];
  for (const kind of (
    process.env.CREATIVE_QA_KINDS || "video,audio,text"
  ).split(",")) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tuzi-media-qa-"));
    const context = await pw[engine].launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 1180, height: 1000 },
      ...(engine === "chromium"
        ? {
            executablePath:
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {}),
    });
    await context.addInitScript(() => {
      window.__qaAudio = [];
      const Original = window.Audio;
      window.Audio = function (...args) {
        const a = new Original(...args);
        window.__qaAudio.push(a);
        return a;
      };
      window.Audio.prototype = Original.prototype;
    });
    const p = await context.newPage();
    p.setDefaultTimeout(20000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === "/synthetic-media.mp4")
        return r.fulfill({
          contentType: "video/mp4",
          body: fs.readFileSync(
            path.join(__dirname, "fixtures/synthetic-video.mp4"),
          ),
        });
      if (u.pathname === "/synthetic-media.wav")
        return r.fulfill({
          contentType: "audio/wav",
          body: fs.readFileSync(
            path.join(__dirname, "fixtures/synthetic-audio.wav"),
          ),
        });
      return u.hostname === "127.0.0.1" ||
        ["data:", "blob:"].includes(u.protocol)
        ? r.continue()
        : r.abort();
    });
    try {
      await p.goto(base + "/ui04.html?canvas=1&page=creative&media-qa=1");
      await configure(p);
      await canvas(p);
      await p.evaluate(
        ({ base }) => {
          const f = window.__creativeRequestFixture;
          Object.assign(f.responses, {
            "POST /v2/video_generation": {
              body: {
                task_id: "synthetic-video-1",
                base_resp: { status_code: 0 },
              },
            },
            "GET /v2/query/video_generation/synthetic-video-1": {
              body: {
                task_id: "synthetic-video-1",
                task: {
                  status: "succeeded",
                  content: { url: base + "/synthetic-media.mp4" },
                },
              },
            },
            "POST /suno/v2/music": {
              body: { code: "success", data: { task_id: "synthetic-audio-1" } },
            },
            "GET /suno/v2/fetch/synthetic-audio-1": {
              body: {
                code: "success",
                data: {
                  task_id: "synthetic-audio-1",
                  action: "music",
                  status: "SUCCESS",
                  data: {
                    musics: [
                      {
                        music_id: "synthetic-music-1",
                        audio_url: base + "/synthetic-media.wav",
                        title: "SYNTHETIC MUSIC",
                      },
                    ],
                  },
                },
              },
            },
            "POST /v1/chat/completions": {
              body: {
                id: "synthetic-text",
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "SYNTHETIC TEXT RESULT",
                    },
                    finish_reason: "stop",
                  },
                ],
              },
            },
          });
          f.hold = true;
        },
        { base },
      );
      await p
        .locator(".generation-type-dropdown__trigger:visible")
        .first()
        .click();
      await p
        .locator(".generation-type-dropdown__item")
        .filter({
          hasText: { video: "视频", audio: "音频", text: "文本" }[kind],
        })
        .click();
      await p.locator(".model-dropdown__trigger:visible").first().click();
      const model = {
        video: "MiniMax-H3",
        audio: "suno/music",
        text: "synthetic-chat",
      }[kind];
      await p.getByText(model, { exact: true }).last().click();
      await p
        .locator(".ai-input-bar__input:visible")
        .first()
        .fill("SYNTHETIC " + kind + " acceptance");
      await p
        .locator('[data-track="ai_input_click_send"]:visible')
        .first()
        .click();
      await p.waitForFunction(() =>
        window.__creativeRequestFixture.requests.some(
          (r) => r.method === "POST",
        ),
      );
      const card = p.locator(".workzone-native-card");
      await card.waitFor();
      assert.match(await card.textContent(), /正在提交|生成中|等待执行/);
      const box = await card.boundingBox();
      assert(box && box.width > 100 && box.height > 80);
      await p.screenshot({ path: `${out}/${kind}-pending.png` });
      const outcome = process.env.CREATIVE_QA_OUTCOME || "success";
      if (outcome === "cancel") {
        await p.getByRole("button", { name: "任务队列", exact: true }).click();
        await p.locator('[data-track="task_click_toggle_selection"]').click();
        await p.locator(".task-queue-panel__batch-select label").click();
        await p.locator('[data-track="task_click_batch_cancel"]').click();
      } else {
        if (outcome === "failure")
          await p.evaluate(() => {
            for (const [key, value] of Object.entries(
              window.__creativeRequestFixture.responses,
            )) {
              if (key.startsWith("POST ")) {
                value.status = 422;
                value.body = {
                  error: { message: "SYNTHETIC validation failure" },
                  message: "SYNTHETIC validation failure",
                };
              }
            }
          });
        await p.evaluate(
          (holdPoll) => {
            window.__creativeRequestFixture.release();
            window.__creativeRequestFixture.holdPoll = holdPoll;
          },
          outcome === "success" && kind !== "text",
        );
        if (outcome === "success" && kind !== "text") {
          await p.waitForFunction(() =>
            window.__creativeRequestFixture.requests.some(
              (r) => r.method === "GET" && r.path !== "/v1/models",
            ),
          );
          await until(
            async () => /生成中/.test(await card.textContent()),
            "Canvas must show generating after submission",
          );
          await p
            .getByRole("button", { name: "任务队列", exact: true })
            .click();
          await p
            .locator(".task-item--processing")
            .getByText("生成中", { exact: true })
            .first()
            .waitFor();
          await p.screenshot({ path: `${out}/${kind}-polling.png` });
          await p
            .getByRole("button", { name: "任务队列", exact: true })
            .click();
          await p.evaluate(() => window.__creativeRequestFixture.release());
        }
      }
      if (outcome !== "success") {
        const status = outcome === "cancel" ? "cancelled" : "failed";
        await until(
          async () =>
            (await records(p, "aitu-app", "tasks")).some(
              (t) => t.status === status,
            ),
          "Terminal state missing",
        );
        await until(
          async () =>
            new RegExp(outcome === "cancel" ? "已取消" : "生成失败").test(
              await card.textContent(),
            ),
          "Canvas and task terminal states disagree",
        );
        await p.screenshot({ path: `${out}/${kind}-${outcome}.png` });
        assert.equal(
          await p.evaluate(
            () =>
              window.__creativeRequestFixture.requests.filter(
                (r) => r.method === "POST",
              ).length,
          ),
          1,
        );
        await p.reload();
        await p.locator(".plait-board-container").waitFor();
        await until(
          async () =>
            (await records(p, "aitu-app", "tasks")).some(
              (t) => t.status === status,
            ),
          "Terminal state lost on reload",
        );
        assert.equal(
          await p.evaluate(
            () =>
              window.__creativeRequestFixture.requests.filter(
                (r) => r.method === "POST",
              ).length,
          ),
          0,
        );
        results.push({
          kind,
          outcome,
          status: "passed",
          posts: 1,
          reloadPosts: 0,
        });
        continue;
      }

      await until(
        async () => {
          const ts = await records(p, "aitu-app", "tasks");
          const failed = ts.find((t) => t.status === "failed");
          if (failed)
            throw Error("Task failed: " + JSON.stringify(failed.error));
          return ts.some((t) => t.status === "completed");
        },
        "Task never completed",
        45000,
      );
      await until(
        async () =>
          (await records(p, "aitu-app", "tasks")).some(
            (t) => t.insertedToCanvas,
          ),
        "Result not inserted into canvas",
        30000,
      );
      if (kind === "video") {
        const video = p.locator(".plait-board-container video").first();
        await video.waitFor();
        await until(
          () => video.evaluate((v) => v.readyState >= 1 && !v.error),
          "Video did not decode/play",
          30000,
        );
        await video.evaluate((v) => {
          v.muted = true;
          return v.play();
        });
        await until(
          () => video.evaluate((v) => v.currentTime > 0.2),
          "Video clock did not advance",
        );
      }
      if (kind === "audio") {
        await p.locator(".audio-node__artwork").first().click();
        await p.waitForFunction(() =>
          window.__qaAudio.some((a) => a.currentTime > 0.2 && !a.error),
        );
      }
      if (kind === "text") {
        await p.keyboard.down("Space");
        await p.mouse.move(1000, 500);
        await p.mouse.down();
        await p.mouse.move(1000, 220, { steps: 10 });
        await p.mouse.up();
        await p.keyboard.up("Space");
        const result = p
          .getByText("SYNTHETIC TEXT RESULT", { exact: true })
          .first();
        await result.waitFor();
        assert(
          await result.evaluate((e) => {
            const r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return hit === e || e.contains(hit);
          }),
          "Generated text must be unobstructed",
        );
      }
      if (kind === "video") {
        const buffer = await p.locator("video").first().screenshot();
        fs.writeFileSync(`${out}/video-frame.png`, buffer);
        const { PNG } = require(
          process.env.PLAYWRIGHT_MODULE
            ? path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), "pngjs")
            : "pngjs",
        );
        const png = PNG.sync.read(buffer);
        let colored = 0;
        for (let i = 0; i < png.data.length; i += 4) {
          const [r, g, b] = png.data.subarray(i, i + 3);
          if (Math.max(r, g, b) - Math.min(r, g, b) > 90) colored++;
        }
        assert(colored > 1000, "Video frame must actually paint color bars");
      }
      await p.screenshot({ path: `${out}/${kind}-completed.png` });
      const tasks = await records(p, "aitu-app", "tasks");
      const boards = await records(p, "aitu-workspace", "boards");
      fs.writeFileSync(
        `${out}/${kind}-state.json`,
        JSON.stringify({ tasks, boards }, null, 2),
      );
      assert.equal(
        await p.evaluate(
          () =>
            window.__creativeRequestFixture.requests.filter(
              (r) => r.method === "POST",
            ).length,
        ),
        1,
        "No duplicate submission",
      );
      assert.deepEqual(errors, []);
      await p.reload();
      await p.locator(".plait-board-container").waitFor();
      await until(
        async () =>
          (await records(p, "aitu-app", "tasks")).some(
            (t) => t.status === "completed",
          ),
        "Result not persisted",
      );
      assert.equal(
        await p.evaluate(
          () =>
            window.__creativeRequestFixture.requests.filter(
              (r) => r.method === "POST",
            ).length,
        ),
        0,
        "Reload must not resubmit",
      );
      if (kind === "video") {
        const v = p.locator("video").first();
        await v.waitFor();
        await until(
          () => v.evaluate((v) => v.readyState >= 1 && !v.error),
          "Reloaded video did not resolve cached media",
          30000,
        );
        await v.evaluate((v) => {
          v.muted = true;
          return v.play();
        });
        await until(
          () => v.evaluate((v) => v.currentTime > 0.2),
          "Reloaded video must play",
        );
      }
      if (kind === "audio") {
        await p.locator(".audio-node__artwork").first().click();
        await p.waitForFunction(() =>
          window.__qaAudio.some((a) => a.currentTime > 0.2 && !a.error),
        );
      }
      if (kind === "text")
        await p
          .getByText("SYNTHETIC TEXT RESULT", { exact: true })
          .first()
          .waitFor();
      await p.screenshot({ path: `${out}/${kind}-reloaded.png` });
      results.push({ kind, status: "passed", posts: 1, reloadPosts: 0 });
    } catch (e) {
      results.push({ kind, status: "failed", error: e.message });
      console.error(kind, e.stack);
      fs.writeFileSync(
        `${out}/${kind}-media-diagnostics.json`,
        JSON.stringify(
          await p.locator("video,audio").evaluateAll((es) =>
            es.map((v) => ({
              html: v.outerHTML,
              src: v.currentSrc,
              readyState: v.readyState,
              networkState: v.networkState,
              error: v.error && {
                code: v.error.code,
                message: v.error.message,
              },
              width: v.videoWidth,
              box: v.getBoundingClientRect().toJSON(),
            })),
          ),
          null,
          2,
        ),
      );
      await p.screenshot({ path: `${out}/${kind}-failure.png` });
      fs.writeFileSync(
        `${out}/${kind}-failure.txt`,
        (await p.locator("body").textContent()) +
          "\n" +
          JSON.stringify(
            await p.evaluate(() => window.__creativeRequestFixture),
          ) +
          "\n" +
          JSON.stringify(await records(p, "aitu-app", "tasks")),
      );
    } finally {
      await context.close();
    }
  }
  fs.writeFileSync(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
