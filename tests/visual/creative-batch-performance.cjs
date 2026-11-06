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
        p.on("pageerror", (e) => { errors.push(e.message); console.error("Page error", e.message); });
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
            startup: [],
            submittedAt: null,
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
            if (window.__perf.submittedAt !== null && window.__perf.startup.length < 120) {
              const preparation = [...document.querySelectorAll('.batch-preparation-slot')];
              const slots = preparation.length ? preparation : [...document.querySelectorAll('.image-generation-anchor-desktop-fallback')];
              window.__perf.startup.push({ms: performance.now() - window.__perf.submittedAt, count: slots.length});
            }
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
        const existingCount = Number(process.env.PERF_EXISTING_COUNT || 0);
        if (existingCount) {
          // Seed only this fresh synthetic browser profile, never a user's board.
          await p.waitForTimeout(1000);
          console.log("Seeding existing images", existingCount);
          await p.evaluate((count) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("Synthetic seed timed out")), 15000);
            const open = indexedDB.open('aitu-workspace');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('boards', 'readwrite');
              const store = tx.objectStore('boards');
              const read = store.getAll();
              read.onsuccess = () => {
                const board = read.result[0];
                if (!board) { reject(Error('Synthetic board missing')); return; }
                const url = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#8ac"/></svg>');
                board.elements = Array.from({ length: count }, (_, i) => {
                  const x = (i % 6) * 240, y = Math.floor(i / 6) * 240;
                  return { id: 'synthetic-existing-' + i, type: 'image', url, points: [[x,y],[x+200,y+200]], angle: 0 };
                });
                store.put(board, board.id);
              };
              tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(); };
              tx.onabort = () => reject(tx.error || Error('Synthetic seed aborted'));
              tx.onerror = () => reject(tx.error);
            };
          }), existingCount);
          console.log("Seed saved; reloading");
          await p.reload();
          await p.locator('[plait-data-id="synthetic-existing-0"]').waitFor();
          console.log("Existing canvas mounted");
        }
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
        await p.evaluate(() => { window.__perf.submittedAt = performance.now(); });
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
        if (process.env.PERF_ASSERT_GRID === '1' && count > 1) {
          const firstRow = await p.locator('.image-generation-anchor-desktop-fallback').evaluateAll(nodes => nodes.slice(0,3).map(node => {
            const box = node.getBoundingClientRect(); return { x: box.x, right: box.right, y: box.y, bottom: box.bottom };
          }));
          assert(firstRow.every(box => box.x >= 0 && box.right <= 1360 && box.y >= 120 && box.bottom < 900), 'Initial first row must fit the synthetic 1360px viewport');
          await p.screenshot({ path: output + '/initial-' + engine + '-' + count + '.png' });
        }
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
        for (let step = 1; step <= 25; step++) {
          await p.mouse.move(550 + step * 4, 350 + step * 4);
          await p.waitForTimeout(16);
        }
        await p.mouse.up();
        await p.waitForTimeout(Math.max(1, 8000 - (Date.now() - started)));
        const afterPan = await p
          .locator(".image-generation-anchor-desktop-fallback")
          .first()
          .boundingBox();
        if (!beforePan || !afterPan || Math.max(Math.abs(afterPan.x - beforePan.x), Math.abs(afterPan.y - beforePan.y)) <= 20) {
          await p.screenshot({ path: output + '/pan-failure-' + engine + '-' + count + '.png' });
          console.error('Pan diagnostic', { beforePan, afterPan, hit: await p.evaluate(() => document.elementFromPoint(550,350)?.outerHTML.slice(0,600)) });
        }
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
          existingCount,
          startup: raw.startup,
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
          const slotPositions = await p.locator('.image-generation-anchor-desktop-fallback').evaluateAll(nodes => nodes.map(node => {
            const box = node.getBBox(); return { x: box.x, y: box.y };
          }));
          const firstSlotBox = await p.locator('.image-generation-anchor-desktop-fallback').first().boundingBox();
          assert(firstSlotBox && firstSlotBox.x < 1360 && firstSlotBox.x + firstSlotBox.width > 0 && firstSlotBox.y < 900 && firstSlotBox.y + firstSlotBox.height > 120, 'First slot must be visible after submission and pan');
          const viewport = await p.locator('.board-host-svg .element-host').first().evaluate(node => { const m = node.getScreenCTM(); return [m.a,m.b,m.c,m.d,m.e,m.f]; });
          await p.screenshot({ path: output + '/pending-' + count + '.png' });
          await p.evaluate(() => {
            window.__perf.frames = []; window.__perf.long = [];
            window.__creativeRequestFixture.release();
          });
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
          const completion = await p.evaluate(() => ({ frames: window.__perf.frames, long: window.__perf.long }));
          result.completion = { frameP95: percentile(completion.frames, 0.95), longTasks: completion.long.length, longTaskMs: completion.long.reduce((a,b) => a+b,0) };
          result.slotPositions = slotPositions;
          if (process.env.PERF_ASSERT_GRID === '1' && count > 1) {
            const first = slotPositions[0];
            assert.equal(new Set(slotPositions.slice(0, Math.min(3,count)).map(pos => Math.round(pos.y))).size, 1);
            if (count > 3) { assert.equal(Math.round(slotPositions[3].x), Math.round(first.x)); assert(slotPositions[3].y > first.y); }
            const afterViewport = await p.locator('.board-host-svg .element-host').first().evaluate(node => { const m = node.getScreenCTM(); return [m.a,m.b,m.c,m.d,m.e,m.f]; });
            assert.deepEqual(afterViewport, viewport, 'Batch completion must not take over the viewport');
          }
          const savedElements = await p.evaluate(() => new Promise((resolve, reject) => {
            const open = indexedDB.open('aitu-workspace');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result, read = db.transaction('boards').objectStore('boards').getAll();
              read.onsuccess = () => { resolve(read.result.flatMap(board => board.elements)); db.close(); };
              read.onerror = () => reject(read.error);
            };
          }));
          if (process.env.PERF_ASSERT_GRID === '1' && count > 1) {
            const actualPositions = savedElements.filter(el => el.type === 'image' && el.generationTaskId).map(el => el.points[0].map(Math.round).join(','));
            assert.deepEqual(actualPositions.sort(), slotPositions.map(pos => [Math.round(pos.x),Math.round(pos.y)].join(',')).sort(), 'Every result must keep its reserved slot');
          }
          for (let i = 0; i < existingCount; i++) {
            const existing = savedElements.find(el => el.id === 'synthetic-existing-' + i);
            const x = (i % 6) * 240, y = Math.floor(i / 6) * 240;
            assert.deepEqual(existing?.points, [[x,y],[x+200,y+200]], 'Existing content must not move');
          }
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
