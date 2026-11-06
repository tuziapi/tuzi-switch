// UI simulation only. All external requests are blocked; IPC cannot install software.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const out = process.env.UPDATE_QA_OUTPUT || "/tmp/tuzi-official-native-updates";
const base = process.env.UPDATE_QA_URL || "http://127.0.0.1:5264";
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const results = [];
  try {
    const cases = [
      ...["macos", "macos-intel", "windows", "linux"].map((platform) => ({
        platform,
        scenario: "success",
      })),
      ...["network", "signature", "busy", "save", "install"].map(
        (scenario) => ({ platform: "macos", scenario }),
      ),
    ];
    for (const [index, { platform, scenario }] of cases.entries()) {
      const theme = index % 2 ? "dark" : "light";
      const context = await browser.newContext({
        viewport: { width: index % 2 ? 900 : 1200, height: 780 },
      });
      const page = await context.newPage();
      const errors = [],
        external = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).hostname === "127.0.0.1")
          return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      try {
        await page.goto(
          `${base}/official-inapp-update.html?platform=${platform}&scenario=${scenario}&theme=${theme}`,
        );
        await page
          .getByRole("button", { name: "查看更新", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText(/合成正式更新/).waitFor();
        assert.equal(await page.locator("output").innerText(), "");
        await page.screenshot({
          path: `${out}/${platform}-${scenario}-notes.png`,
        });
        await dialog
          .getByRole("button", { name: "下载更新", exact: true })
          .click();
        if (["network", "signature"].includes(scenario)) {
          await dialog.getByRole("alert").waitFor();
          assert(!(await page.locator("output").innerText()).includes("安装"));
          assert.equal(
            await dialog.getByRole("button", { name: "重启并更新" }).count(),
            0,
          );
          await dialog
            .getByRole("button", { name: "重新下载", exact: true })
            .click();
        }
        await dialog
          .getByRole("button", { name: "重启并更新", exact: true })
          .waitFor();
        assert(!(await page.locator("output").innerText()).includes("安装"));
        await page.screenshot({
          path: `${out}/${platform}-${scenario}-ready.png`,
        });
        await dialog.getByRole("button", { name: "稍后", exact: true }).click();
        await page
          .getByRole("button", { name: "检测到新版本：1.5.7", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "重启并更新", exact: true })
          .click();
        if (["busy", "save"].includes(scenario)) {
          await dialog.getByRole("alert").waitFor();
          assert(!(await page.locator("output").innerText()).includes("安装"));
          await dialog
            .getByRole("button", { name: "重启并更新", exact: true })
            .click();
        }
        if (scenario === "install") {
          await dialog.getByRole("alert").waitFor();
          assert(!(await page.locator("output").innerText()).includes("重启"));
          await dialog
            .getByRole("button", { name: "重新下载", exact: true })
            .click();
          await dialog
            .getByRole("button", { name: "重启并更新", exact: true })
            .click();
        }
        await page.waitForFunction(() =>
          document.querySelector("output").textContent.endsWith("重启"),
        );
        const trace = await page.locator("output").innerText();
        assert(trace.endsWith("保存检查 → 原生检查 → 安装 → 重启"));
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        results.push({ platform, scenario, theme, trace, passed: true });
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
