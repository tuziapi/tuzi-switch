const fs = require("node:fs");
const path = require("node:path");
const { resolveReleaseRepository } = require("./release-repository.cjs");

const OFFICIAL_REPOSITORY = "tuziapi/tuzi-switch";
const TEST_REPOSITORY = "AiW520/tuzi-switch";

function releaseChannel(env = process.env) {
  const repository = resolveReleaseRepository(env);
  if (![OFFICIAL_REPOSITORY, TEST_REPOSITORY].includes(repository)) {
    throw Error("Unsupported signed release repository");
  }
  // Preserve the existing official trust root. Never substitute the test key.
  const pubkey =
    repository === OFFICIAL_REPOSITORY
      ? JSON.parse(
          fs.readFileSync(
            path.join(__dirname, "../src-tauri/tauri.conf.json"),
            "utf8",
          ),
        ).plugins.updater.pubkey
      : fs
          .readFileSync(path.join(__dirname, "aiw520-updater.pub"), "utf8")
          .trim();
  return { repository, pubkey };
}

module.exports = { releaseChannel, OFFICIAL_REPOSITORY, TEST_REPOSITORY };
