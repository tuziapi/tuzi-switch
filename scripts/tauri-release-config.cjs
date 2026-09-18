const { resolveReleaseRepository } = require("./release-repository.cjs");

const releaseRepository = resolveReleaseRepository();

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

if (process.argv.includes("--desktop-product-name")) {
  config.productName = "tuzi switch";
}

if (process.argv.includes("--unsigned")) {
  config.bundle = { createUpdaterArtifacts: false };
}

process.stdout.write(JSON.stringify(config));
