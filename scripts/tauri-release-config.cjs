const { resolveReleaseRepository } = require("./release-repository.cjs");

const releaseRepository = resolveReleaseRepository();
const fs = require("node:fs");
const path = require("node:path");

const config = {
  plugins: {
    updater: {
      endpoints: [
        `https://github.com/${releaseRepository}/releases/latest/download/latest.json`,
        `https://raw.githubusercontent.com/${releaseRepository}/release-manifest/latest.json`,
        `https://cdn.jsdelivr.net/gh/${releaseRepository}@release-manifest/latest.json`,
      ],
    },
  },
};

if (releaseRepository === "AiW520/tuzi-switch") {
  config.plugins.updater.pubkey = fs.readFileSync(path.join(__dirname, "aiw520-updater.pub"), "utf8").trim();
  config.plugins.updater.endpoints = [`https://github.com/${releaseRepository}/releases/latest/download/latest.json`];
  config.plugins.updater.windows = { installMode: "passive" };
}

if (process.argv.includes("--desktop-product-name")) {
  config.productName = "tuzi switch";
}

if (process.argv.includes("--unsigned")) {
  config.bundle = { createUpdaterArtifacts: false };
}

process.stdout.write(JSON.stringify(config));
