// Synthetic official release metadata and IPC only; never opens a real installer.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = process.env.UPDATE_QA_OUTPUT || "/tmp/tuzi-official-update-notices";
const base = process.env.UPDATE_QA_URL || "http://127.0.0.1:5263";
const repo = "tuziapi/tuzi-switch";
const installers = {
  macos: "macos-arm64.dmg",
  "macos-intel": "macos-x64.dmg",
  windows: "windows-x64.exe",
  linux: "linux-x64.AppImage",
};
const metadata = {
  tag_name: "v1.5.6",
  html_url: `https://github.com/${repo}/releases/tag/v1.5.6`,
  published_at: "2026-11-05T00:00:00Z",
  body: "合成更新说明：修复画布体验，增加新版本提醒。\n<script>window.untrustedReleaseExecuted = true</script>",
  draft: false,
  prerelease: false,
  assets: Object.values(installers).map((suffix) => ({
    name: `tuzi-assistant-${suffix}`,
    browser_download_url: `https://github.com/${repo}/releases/download/v1.5.6/tuzi-assistant-${suffix}`,
    size: 123,
    state: "uploaded",
    digest: `sha256:${"a".repeat(64)}`,
  })),
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const results = [];
  try {
    for (const [index, [platform, suffix]] of Object.entries(
      installers,
    ).entries()) {
      const theme = index % 2 ? "dark" : "light";
      const width = index % 2 ? 680 : 1200;
      const context = await browser.newContext({
        viewport: { width, height: 780 },
      });
      const page = await context.newPage();
      const errors = [];
      const unexpected = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1") return route.continue();
        if (url.href === `https://api.github.com/repos/${repo}/releases/latest`)
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(metadata),
          });
        unexpected.push(url.href);
        return route.abort();
      });
      try {
        await page.goto(
          `${base}/update-notification.html?channel=stable&platform=${platform}&theme=${theme}`,
        );
        await page
          .getByRole("button", { name: "查看更新", exact: true })
          .waitFor();
        assert.equal(await page.locator("output").innerText(), "");
        await page.screenshot({ path: `${out}/${platform}-notice.png` });
        await page
          .getByRole("button", { name: "查看更新", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText(/下载完成后请手动安装/).waitFor();
        assert((await dialog.innerText()).includes("合成更新说明"));
        assert.equal(await dialog.locator("script").count(), 0);
        assert.equal(
          await page.evaluate(() => window.untrustedReleaseExecuted),
          undefined,
        );
        assert.equal(
          await dialog.getByRole("button", { name: "重启并更新" }).count(),
          0,
        );
        assert.equal(await page.locator("output").innerText(), "");
        await page.screenshot({ path: `${out}/${platform}-dialog.png` });
        await dialog
          .getByRole("button", { name: "下载安装包", exact: true })
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector("output")
            .textContent.includes("/releases/download/"),
        );
        assert.equal(
          await page.locator("output").innerText(),
          `https://github.com/${repo}/releases/download/v1.5.6/tuzi-assistant-${suffix}`,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        results.push({ platform, theme, width, passed: true });
      } finally {
        await context.close();
      }
    }
    fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
