import { writeFile, copyFile } from "node:fs/promises";
import { repository, createStableRelease } from "../src/stableRelease.js";
const tag = process.env.RELEASE_TAG;
if (tag && !/^v\d+\.\d+\.\d+$/.test(tag)) throw Error("Invalid release tag");
const response = await fetch(
  `https://api.github.com/repos/${repository}/releases/${tag ? `tags/${tag}` : "latest"}`,
  {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "tuzi-download-build",
      ...(process.env.GH_TOKEN
        ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
        : {}),
    },
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok) throw Error(`Release lookup failed: ${response.status}`);
const metadata = createStableRelease(await response.json());
await writeFile(
  "public/release.json",
  JSON.stringify(metadata, null, 2) + "\n",
);
await copyFile("LICENSE", "public/LICENSE.txt");
console.log(
  `Verified ${metadata.tag}: ${metadata.downloads.length} direct installers`,
);
