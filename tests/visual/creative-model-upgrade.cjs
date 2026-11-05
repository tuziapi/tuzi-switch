// Real host startup + catalog storage, synthetic native transport; external requests blocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CREATIVE_QA_BROWSER || "chromium";
const base = process.env.CREATIVE_QA_BASE_URL || "http://127.0.0.1:5197";
const out = process.env.CREATIVE_QA_OUTPUT || "/tmp/tuzi-model-upgrade";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await pw[engine].launch({
    headless: true,
    ...(engine === "chromium"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
  });
  const results = [];
  try {
    for (const mode of ["manual", "account"]) {
      const context = await browser.newContext({
        viewport: { width: 1360, height: 900 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "127.0.0.1" ||
          /^(data|blob):$/.test(url.protocol)
          ? route.continue()
          : route.abort();
      });
      await page.addInitScript(
        ({ mode }) => {
          const ids = [
            "gpt-image-2.6-1k",
            "gpt-image-2.6-flare",
            "gpt-image-2.6-sunburst",
          ];
          let fixture;
          Object.defineProperty(window, "__creativeRequestFixture", {
            configurable: true,
            get: () => fixture,
            set: (value) => {
              fixture = value;
              value.responses["GET /v1/models"] = {
                body: {
                  data: ["gpt-image-2", "gpt-image-2.5", ...ids].map((id) => ({
                    id,
                    supported_endpoint_types: [
                      "image-generation",
                      "image-edit",
                    ],
                  })),
                },
              };
            },
          });
          if (localStorage.getItem("drawnix_settings")) return;
          const model = (id) => ({
            id,
            label: id,
            type: "image",
            vendor: "GPT",
          });
          const key =
            mode === "account"
              ? "tuzi-account:tuzi-account-synthetic"
              : "SYNTHETIC-ONLY-NO-REAL-KEY";
          const baseUrl =
            mode === "account"
              ? "https://api.tu-zi.com/v1"
              : "https://creative.synthetic.invalid/v1";
          localStorage.setItem(
            "drawnix_settings",
            JSON.stringify({
              gemini: { apiKey: key, baseUrl, imageModelName: "gpt-image-2" },
              providerProfiles: [
                {
                  id: "legacy-default",
                  name: "Synthetic upgrade",
                  baseUrl,
                  apiKey: key,
                  enabled: true,
                  providerType: "openai-compatible",
                  authType: "bearer",
                  capabilities: {
                    supportsModelsEndpoint: true,
                    supportsImage: true,
                  },
                  imageApiCompatibility: "openai-gpt-image",
                },
              ],
              providerCatalogs: [
                {
                  profileId: "legacy-default",
                  discoveredAt: 1,
                  discoveredModels: [
                    model("gpt-image-2"),
                    model("gpt-image-2.5"),
                    { ...model("user-custom"), tags: ["manual"] },
                  ],
                  selectedModelIds: ["gpt-image-2", "user-custom"],
                },
              ],
              migrations: {
                compatibilityDefaultModelsV2: true,
                legacyDefaultImageModelV1: true,
                legacyDefaultImageApiCompatibilityV1: true,
                independentManualProvidersV1: true,
              },
            }),
          );
        },
        { mode },
      );
      try {
        await page.goto(`${base}/ui04.html?canvas=1&page=account&media-qa=1`);
        await page.waitForFunction(
          () =>
            JSON.parse(
              localStorage.getItem("tuzi-creative-model-refresh-v1") || "{}",
            )["legacy-default"],
          null,
          { timeout: 30000 },
        );
        assert.equal(await page.locator(".plait-board-container").count(), 0);
        assert.equal(await page.getByTestId("settings-dialog").count(), 0);
        const check = async () =>
          page.evaluate(() => {
            const settings = JSON.parse(
              localStorage.getItem("drawnix_settings"),
            );
            const catalog = settings.providerCatalogs.find(
              (item) => item.profileId === "legacy-default",
            );
            return {
              selected: catalog.selectedModelIds,
              models: catalog.discoveredModels.map((item) => item.id),
              current: settings.gemini.imageModelName,
              requests: window.__creativeRequestFixture.requests,
            };
          });
        const state = await check();
        assert.deepEqual(
          [...state.selected].sort(),
          [
            "gpt-image-2",
            "gpt-image-2.6-1k",
            "gpt-image-2.6-flare",
            "gpt-image-2.6-sunburst",
            "user-custom",
          ].sort(),
        );
        assert(state.models.includes("gpt-image-2.5"));
        assert.equal(state.current, "gpt-image-2");
        assert.equal(
          state.requests.filter((r) => r.path === "/v1/models").length,
          1,
        );
        assert.equal(
          state.requests.filter((r) => r.method === "POST").length,
          0,
        );
        await page.screenshot({ path: `${out}/${mode}-background.png` });
        await page.reload();
        await page.waitForTimeout(3500);
        assert.equal(
          (await check()).requests.filter((r) => r.path === "/v1/models")
            .length,
          0,
        );
        await page
          .getByRole("button", { name: "opentu 创作", exact: true })
          .click();
        await page
          .getByRole("button", { name: "创作配置", exact: true })
          .click();
        await page.getByTestId("settings-dialog").waitFor();
        await page.waitForTimeout(500);
        assert.equal(
          (await check()).requests.filter((r) => r.path === "/v1/models")
            .length,
          0,
        );
        assert.deepEqual(errors, []);
        results.push({
          mode,
          passed: true,
          selected: state.selected,
          startupModelRequests: 1,
          restartModelRequests: 0,
          generated: 0,
          errors,
        });
      } catch (error) {
        await page.screenshot({ path: `${out}/${mode}-failure.png` });
        console.error(
          mode,
          errors,
          await page.evaluate(() => window.__creativeRequestFixture?.requests),
        );
        throw error;
      } finally {
        await context.close();
      }
    }
    fs.writeFileSync(
      `${out}/results-${engine}.json`,
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
