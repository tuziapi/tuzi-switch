// Synthetic held HTTP only; real workflow, native SVG renderer, canvas and IndexedDB.
// PERF_CPU=6 applies Chrome CPU throttling, not a real device benchmark.
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const os = require("node:os");
const path = require("node:path");
const fs = require("fs");
const assert = require("node:assert/strict");
const output = process.env.CREATIVE_QA_OUTPUT || "/tmp/tuzi-batch-perf";
fs.mkdirSync(output, { recursive: true });
const base = process.env.CREATIVE_QA_BASE_URL || "http://127.0.0.1:5197";
(async () => {
  const browser =
    engine === "webkit"
      ? null
      : await playwright.chromium.launch({
          headless: true,
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        });
  const results = [];
  try {
    for (const count of (process.env.PERF_COUNTS || "1,10,20")
      .split(",")
      .map(Number)) {
      const profile =
        engine === "webkit"
          ? fs.mkdtempSync(path.join(os.tmpdir(), "tuzi-batch-webkit-"))
          : null;
      const c = profile
        ? await playwright.webkit.launchPersistentContext(profile, {
            headless: true,
            viewport: { width: 1360, height: 900 },
          })
        : await browser.newContext({ viewport: { width: 1360, height: 900 } });
      try {
        const p = await c.newPage();
        if (engine === "chromium") {
          const cdp = await c.newCDPSession(p);
          await cdp.send("Emulation.setCPUThrottlingRate", {
            rate: Number(process.env.PERF_CPU || 1),
          });
        }
        const errors = [];
        p.on("pageerror", (e) => errors.push(e.message));
        await c.route("**/*", (r) =>
          new URL(r.request().url()).hostname === "127.0.0.1" ||
          /^(data|blob):/.test(r.request().url())
            ? r.continue()
            : r.abort(),
        );
        await p.addInitScript(() => {
          window.__perf = {
            replacements: 0,
            puts: {},
            frames: [],
            long: [],
            inputs: [],
          };
          const original = Element.prototype.replaceChildren;
          Element.prototype.replaceChildren = function (...a) {
            if (
              this.classList?.contains(
                "image-generation-anchor-desktop-fallback",
              )
            )
              window.__perf.replacements++;
            return original.apply(this, a);
          };
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...a) {
            const key = this.transaction.db.name + "/" + this.name;
            window.__perf.puts[key] = (window.__perf.puts[key] || 0) + 1;
            return put.apply(this, a);
          };
          if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
            new PerformanceObserver((list) =>
              window.__perf.long.push(
                ...list.getEntries().map((e) => e.duration),
              ),
            ).observe({ type: "longtask", buffered: false });
          }
          let prev = 0;
          function frame(t) {
            if (prev) window.__perf.frames.push(t - prev);
            prev = t;
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
          document.addEventListener(
            "input",
            () => {
              const start = performance.now();
              requestAnimationFrame(() =>
                window.__perf.inputs.push(performance.now() - start),
              );
            },
            true,
          );
        });
        await p.goto(base + "/ui04.html?canvas=1&page=creative");
        await p.getByRole("button", { name: "创作配置", exact: true }).click();
        const d = p.getByTestId("settings-dialog");
        await d.getByRole("button", { name: "手动配置", exact: true }).click();
        await d.locator("input[type=password]").fill("sk-SYNTHETIC-PERF");
        await d
          .locator(".settings-dialog__field")
          .filter({ has: p.locator("label").filter({ hasText: /^API 地址$/ }) })
          .locator("input")
          .first()
          .fill("https://creative.synthetic.invalid/v1");
        await d.getByRole("button", { name: "保存", exact: true }).click();
        await d.waitFor({ state: "hidden" });
        await p
          .getByRole("navigation", { name: "创作导航" })
          .getByRole("button", { name: "自由画布", exact: true })
          .click();
        await p.locator(".plait-board-container").waitFor();
        const intro = p.getByText("不再提示", { exact: true });
        if (await intro.isVisible()) await intro.click();
        if (count !== 1) {
          await p.locator(".count-dropdown__trigger").first().click();
          await p
            .locator(".count-dropdown__item")
            .filter({ hasText: new RegExp("^" + count + "个$") })
            .click();
        }
        await p
          .locator(".ai-input-bar__input")
          .first()
          .fill("SYNTHETIC performance " + count);
        await p.evaluate(() => (window.__creativeRequestFixture.hold = true));
        await p.locator('[data-track="ai_input_click_send"]').first().click();
        await p.waitForFunction(() =>
          window.__creativeRequestFixture.requests.some(
            (r) => r.method === "POST",
          ),
        );
        await p.waitForTimeout(1800);
        const anchors = await p
          .locator(".image-generation-anchor-desktop-fallback")
          .count();
        await p.evaluate(() => {
          window.__perf.replacements = 0;
          window.__perf.puts = {};
          window.__perf.frames = [];
          window.__perf.long = [];
          window.__perf.inputs = [];
        });
        await p.waitForTimeout(4000);
        const idle = await p.evaluate(() => ({
          replacements: window.__perf.replacements,
          puts: window.__perf.puts,
        }));
        await p.evaluate(() => {
          window.__perf.replacements = 0;
          window.__perf.puts = {};
          window.__perf.frames = [];
          window.__perf.long = [];
          window.__perf.inputs = [];
        });
        const input = p.locator(".ai-input-bar__input").first();
        await input.fill("");
        const started = Date.now();
        await input.pressSequentially(
          "Typing during generation to check responsiveness.",
          { delay: 100 },
        );
        assert.equal(
          await input.inputValue(),
          "Typing during generation to check responsiveness.",
        );
        await p.locator('[data-track="toolbar_click_hand"]').click();
        const beforePan = await p
          .locator(".image-generation-anchor-desktop-fallback")
          .first()
          .boundingBox();
        await p.mouse.move(550, 350);
        await p.mouse.down();
        await p.mouse.move(650, 450, { steps: 25 });
        await p.mouse.up();
        await p.waitForTimeout(Math.max(1, 8000 - (Date.now() - started)));
        const afterPan = await p
          .locator(".image-generation-anchor-desktop-fallback")
          .first()
          .boundingBox();
        assert(
          beforePan &&
            afterPan &&
            (Math.abs(afterPan.x - beforePan.x) > 20 ||
              Math.abs(afterPan.y - beforePan.y) > 20),
          "Canvas must respond to panning during generation",
        );
        const raw = await p.evaluate(() => window.__perf);
        const percentile = (a, q) =>
          a.length
            ? [...a].sort((x, y) => x - y)[
                Math.min(a.length - 1, Math.floor(a.length * q))
              ]
            : 0;
        const result = {
          count,
          anchors,
          inputVerified: true,
          panDisplacement: {
            x: afterPan.x - beforePan.x,
            y: afterPan.y - beforePan.y,
          },
          engine,
          cpu: engine === "chromium" ? Number(process.env.PERF_CPU || 1) : 1,
          longTasksSupported: await p.evaluate(
            () =>
              PerformanceObserver.supportedEntryTypes?.includes("longtask") ||
              false,
          ),
          idle,
          replacements: raw.replacements,
          puts: raw.puts,
          longTasks: raw.long.length,
          longTaskMs: raw.long.reduce((a, b) => a + b, 0),
          frameP95: percentile(raw.frames, 0.95),
          frameMax: Math.max(...raw.frames),
          inputP95: percentile(raw.inputs, 0.95),
          errors,
        };
        results.push(result);
        console.log(JSON.stringify(result));
        assert.equal(anchors, count);
        assert.deepEqual(errors, []);
        if (process.env.PERF_ASSERT_OPTIMIZED === "1") {
          assert.equal(
            idle.puts["aitu-workspace/boards"] || 0,
            0,
            "Estimated progress must not persist the board",
          );
          assert.equal(
            raw.replacements,
            0,
            "Progress-only updates must retain SVG trees",
          );
        }
        if (process.env.PERF_VERIFY_RESULTS === "1") {
          await p.evaluate(() => window.__creativeRequestFixture.release());
          await p.waitForFunction(
            async (count) => {
              const records = await new Promise((resolve, reject) => {
                const request = indexedDB.open("aitu-workspace");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                  const db = request.result;
                  const read = db
                    .transaction("boards")
                    .objectStore("boards")
                    .getAll();
                  read.onsuccess = () => {
                    resolve(read.result);
                    db.close();
                  };
                  read.onerror = () => reject(read.error);
                };
              });
              return records.some(
                (b) =>
                  b.elements.filter(
                    (e) => e.type === "image" && e.generationTaskId,
                  ).length === count,
              );
            },
            count,
            { timeout: 60000 },
          );
          await p.waitForFunction(
            () =>
              document.querySelectorAll(
                ".image-generation-anchor-desktop-fallback",
              ).length === 0,
            null,
            { timeout: 20000 },
          );
          const requests = await p.evaluate(
            () =>
              window.__creativeRequestFixture.requests.filter(
                (r) => r.method === "POST",
              ).length,
          );
          assert.equal(requests, count, "No duplicated generation requests");
          await p.reload();
          await p.locator(".plait-board-container").waitFor();
          await p.waitForFunction(
            (count) =>
              document.querySelectorAll(
                "[plait-data-id] image,[plait-data-id] foreignObject img",
              ).length >= count,
            count,
            { timeout: 20000 },
          );
          result.resultsPersisted = count;
          result.generationRequests = requests;
          await p.screenshot({ path: output + "/batch-" + count + ".png" });
          assert.deepEqual(errors, []);
        }
      } finally {
        await c.close();
        if (profile) fs.rmSync(profile, { recursive: true, force: true });
      }
    }
  } finally {
    await browser?.close();
    fs.writeFileSync(
      output + "/" + (process.env.PERF_LABEL || "measurement") + ".json",
      JSON.stringify(results, null, 2),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
