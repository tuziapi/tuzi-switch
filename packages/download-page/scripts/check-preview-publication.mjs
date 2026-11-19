import fs from "node:fs";
import { isPreviewRelease, previewRepository } from "../src/previewRelease.js";

const value = JSON.parse(
  fs.readFileSync(
    new URL("../public/preview-release.json", import.meta.url),
    "utf8",
  ),
);
if (!isPreviewRelease(value))
  throw Error("Invalid five-platform preview manifest");
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "tuzi-preview-verifier",
};
if (process.env.GH_TOKEN)
  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
async function api(path) {
  const result = await fetch(
    `https://api.github.com/repos/${previewRepository}/${path}`,
    { headers, signal: AbortSignal.timeout(30000) },
  );
  if (!result.ok) throw Error(`GitHub verification failed: ${result.status}`);
  return result.json();
}
const [release, run, tag] = await Promise.all([
  api(`releases/tags/${value.tag}`),
  api(`actions/runs/${value.runId}`),
  api(`git/ref/tags/${value.tag}`),
]);
if (
  release.draft ||
  !release.prerelease ||
  release.html_url !== value.releaseUrl ||
  tag.object.type !== "commit" ||
  tag.object.sha !== value.commit ||
  run.head_sha !== value.commit ||
  run.path !== ".github/workflows/opentu-test-release.yml" ||
  run.status !== "completed" ||
  run.conclusion !== "success"
)
  throw Error("Release, tag or successful build does not match");
for (const item of value.downloads) {
  const matches = release.assets.filter((asset) => asset.name === item.file);
  if (
    matches.length !== 1 ||
    matches[0].browser_download_url !== item.url ||
    matches[0].size !== item.bytes ||
    matches[0].digest !== `sha256:${item.sha256}` ||
    matches[0].state !== "uploaded"
  )
    throw Error(`Asset mismatch: ${item.platform}`);
}
const sources = release.assets.filter(
  (asset) => asset.browser_download_url === value.sourceUrl,
);
if (
  sources.length !== 1 ||
  sources[0].state !== "uploaded" ||
  sources[0].size <= 0
)
  throw Error("Missing corresponding source");
console.log(
  `Verified public beta ${value.version}: five assets, source, immutable tag and successful build ${value.runId}`,
);
