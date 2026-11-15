// Real creative modules and IndexedDB; host IPC uses the existing synthetic fixture.
// Run against `pnpm preview:creative`. All external network requests are blocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = path.resolve(
  process.env.CREATIVE_QA_OUTPUT || "/tmp/tuzi-creative-qa",
);
fs.mkdirSync(output, { recursive: true });

async function eventually(read, predicate) {
  for (let i = 0; i < 60; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Expected persisted state was not reached");
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 900 },
  });
  const errors = [];
  const blocked = new Set();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === "127.0.0.1" ||
      ["data:", "blob:"].includes(url.protocol)
    )
      return route.continue();
    blocked.add(url.origin);
    return route.abort();
  });
  const url = "http://127.0.0.1:5197/ui04.html?canvas=1&page=creative";
  const nav = () => page.getByRole("navigation", { name: "创作导航" });
  const boards = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("aitu-workspace");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db
              .transaction("boards")
              .objectStore("boards")
              .getAll();
            request.onsuccess = () => {
              resolve(request.result);
              db.close();
            };
            request.onerror = () => reject(request.error);
          };
        }),
    );
  try {
    await page.goto(url);
    // Seed a removed tab and synthetic legacy data; the app must not delete it.
    await page.evaluate(async () => {
      sessionStorage.setItem("tuzi-creative-page", "workflow");
      await new Promise((resolve, reject) => {
        const open = indexedDB.open("infinite-canvas");
        open.onupgradeneeded = () => open.result.createObjectStore("app_state");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("app_state", "readwrite");
          tx.objectStore("app_state").put(
            "synthetic-preserved",
            "removal-test",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload();
    assert.equal(
      await nav().getByRole("button", { name: "工作流", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "新建项目", exact: true }).waitFor();
    assert.equal(await page.locator("aside").count(), 0);
    assert.equal((await page.locator("main").boundingBox()).x, 0);
    await page.screenshot({ path: path.join(output, "projects.png") });
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.locator(".plait-board-container").waitFor();
    const intro = page.getByText("不再提示", { exact: true });
    if (await intro.isVisible()) await intro.click();
    await page.getByRole("button", { name: "画笔 — P", exact: true }).click();
    await page.mouse.move(550, 320);
    await page.mouse.down();
    await page.mouse.move(680, 280, { steps: 12 });
    await page.mouse.move(780, 350, { steps: 12 });
    await page.mouse.up();
    const saved = await eventually(
      boards,
      (items) => items[0]?.elements.length > 0,
    );
    const elements = saved[0].elements;
    await page.screenshot({ path: path.join(output, "canvas.png") });

    // Opening/dismissing the top navigation must not resize or remount the editor.
    const background = await page
      .locator(".desktop-warm-canvas")
      .evaluate((el) => ({
        color: getComputedStyle(el).backgroundColor,
        image: getComputedStyle(el).backgroundImage,
        gap: el.style.getPropertyValue("--desktop-dot-gap"),
      }));
    assert.equal(background.color, "rgb(252, 250, 246)");
    assert(background.image.includes("radial-gradient"));
    assert(background.gap.endsWith("px"));
    const editorHandle = await page
      .locator(".plait-board-container")
      .elementHandle();
    const editorBox = await page
      .locator(".plait-board-container")
      .boundingBox();
    const menu = () =>
      page.getByRole("button", { name: "兔子助手导航", exact: true });
    const openMenu = async () => {
      await menu().click();
      await page.getByRole("dialog", { name: "兔子助手导航" }).waitFor();
      // Let the popover finish mounting its document-level outside-click listener.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    await openMenu();
    await page.getByRole("dialog", { name: "兔子助手导航" }).waitFor();
    assert.deepEqual(
      await page.locator(".plait-board-container").boundingBox(),
      editorBox,
    );
    await page.screenshot({ path: path.join(output, "navigation-open.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await openMenu();
    await page.getByRole("button", { name: "向上收起导航" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await openMenu();
    await page.mouse.click(900, 70);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert(await editorHandle.evaluate((el) => el.isConnected));
    await page.screenshot({
      path: path.join(output, "canvas.png"),
      animations: "disabled",
    });
    assert.deepEqual((await boards())[0].elements, elements);
    await openMenu();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await eventually(
      () => page.locator("aside").boundingBox(),
      (box) => box.width === 228,
    );
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await eventually(
      () => page.locator("aside").boundingBox(),
      (box) => box.width === 68,
    );
    await page
      .getByRole("button", { name: "opentu 创作", exact: true })
      .click();
    await page.locator(".plait-board-container").waitFor();
    await page.locator(".tuzi-sidebar-transition").waitFor({ state: "hidden" });
    assert.equal(await page.locator("aside").count(), 0);
    await openMenu();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await eventually(
      () => page.locator("aside").boundingBox(),
      (box) => box.width === 68,
    );
    assert.equal(await page.locator(".creative-root").count(), 0);
    await page
      .getByRole("button", { name: "opentu 创作", exact: true })
      .click();
    await page.locator(".plait-board-container").waitFor();
    assert.deepEqual((await boards())[0].elements, elements);
    await page.reload();
    await page.locator(".plait-board-container").waitFor();
    assert.deepEqual((await boards())[0].elements, elements);

    await nav().getByRole("button", { name: "我的项目", exact: true }).click();
    await page
      .getByRole("button", { name: "重命名 未命名项目", exact: true })
      .click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("本地保存验证");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await eventually(boards, (items) => items[0]?.name === "本地保存验证");
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await eventually(boards, (items) => items.length === 2);
    assert.equal(page.url(), url);
    assert.equal(await page.getByTestId("workflow-mode-button").count(), 0);
    await page.evaluate(async () => {
      const marker = await new Promise((resolve, reject) => {
        const open = indexedDB.open("infinite-canvas");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("app_state")
            .objectStore("app_state")
            .get("removal-test");
          request.onsuccess = () => {
            resolve(request.result);
            db.close();
          };
          request.onerror = () => reject(request.error);
        };
      });
      if (marker !== "synthetic-preserved")
        throw new Error("Legacy user data was modified");
    });
    await nav().getByRole("button", { name: "我的项目", exact: true }).click();
    const widths = [];
    for (const width of [1360, 1024, 900]) {
      await page.setViewportSize({ width, height: 800 });
      widths.push(
        await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      );
    }
    assert(widths.every((item) => item.scroll <= item.width));
    await page.screenshot({ path: path.join(output, "projects-900.png") });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(url + "&theme=dark");
    await page.locator('.creative-root[data-theme="dark"]').waitFor();
    assert.equal(
      await page
        .locator(".creative-project-card")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(41, 41, 37)",
    );
    await page.screenshot({ path: path.join(output, "projects-dark.png") });
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      checks: [
        "real drawing",
        "IndexedDB persistence",
        "tool round trip",
        "reload recovery",
        "desktop warm dot canvas",
        "automatic sidebar hide",
        "top navigation dismissal",
        "sidebar preference restore",
        "editor remains mounted",
        "rename",
        "multiple projects",
        "workflow entry removed",
        "legacy tab fallback",
        "legacy data preserved",
        "host URL unchanged",
        "full width creative layout",
        "responsive widths",
        "dark projects",
      ],
      widths,
      externalRequestsBlocked: [...blocked],
      pageErrors: errors,
    };
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
