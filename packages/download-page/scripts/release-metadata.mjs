import { writeFile, copyFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  repository,
  createStableRelease,
  isStableRelease,
} from "../src/stableRelease.js";
import { macosInstallerTag, macosInstallerUrl } from "../src/macosInstaller.js";
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
const scriptTarget = "public/install-macos-v1.5.5.sh";
// A later release must not accidentally advertise this older pinned installer.
await rm(scriptTarget, { force: true });
if (
  repository === "tuziapi/tuzi-switch" &&
  metadata.tag === macosInstallerTag
) {
  const script = await readFile("../../scripts/install-macos.sh");
  for (const id of ["macos", "macos-intel"]) {
    const download = metadata.downloads.find((item) => item.id === id);
    if (!script.toString().includes(`SHA256=${download.sha256}`))
      throw Error(
        `Pinned installer checksum does not match published ${id} asset`,
      );
  }
  if (!script.toString().includes(`VERSION=${metadata.tag.slice(1)}\n`))
    throw Error("Pinned installer version does not match release");
  metadata.macosInstaller = {
    tag: metadata.tag,
    href: macosInstallerUrl,
    sha256: createHash("sha256").update(script).digest("hex"),
  };
  await writeFile(scriptTarget, script);
}
if (!isStableRelease(metadata)) throw Error("Invalid installer metadata");
await writeFile(
  "public/release.json",
  JSON.stringify(metadata, null, 2) + "\n",
);
await copyFile("LICENSE", "public/LICENSE.txt");
console.log(
  `Verified ${metadata.tag}: ${metadata.downloads.length} direct installers`,
);
