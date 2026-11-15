const { releaseChannel } = require("./release-channel.cjs");
const { repository, pubkey } = releaseChannel();
const config = {
  plugins: {
    updater: {
      pubkey,
      endpoints: [
        `https://github.com/${repository}/releases/latest/download/latest.json`,
      ],
      windows: { installMode: "passive" },
    },
  },
};
if (process.argv.includes("--desktop-product-name"))
  config.productName = "tuzi switch";
if (process.argv.includes("--unsigned"))
  config.bundle = { createUpdaterArtifacts: false };
process.stdout.write(JSON.stringify(config));
