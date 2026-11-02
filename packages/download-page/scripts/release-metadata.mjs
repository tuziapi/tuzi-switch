// Pin the main download to a verified complete opentu installer build.
import { writeFile, readFile, copyFile } from "node:fs/promises";
import {
  ACCEPTANCE_REPOSITORY,
  createAcceptanceRelease,
} from "../src/acceptanceRelease.js";
const pin = JSON.parse(await readFile("acceptance-build.json", "utf8"));
async function github(path) {
  const response = await fetch(
    `https://api.github.com/repos/${ACCEPTANCE_REPOSITORY}/${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tuzi-download-build",
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(`Acceptance lookup failed: ${response.status}`);
  return response.json();
}
if (!/^\d+$/.test(pin.runId)) throw new Error("Invalid run ID");
const [run, result] = await Promise.all([
  github(`actions/runs/${pin.runId}`),
  github(`actions/runs/${pin.runId}/artifacts?per_page=100`),
]);
if (result.total_count > result.artifacts.length)
  throw new Error("Incomplete installer listing");
const metadata = createAcceptanceRelease(pin, run, result.artifacts);
await writeFile(
  "public/release.json",
  JSON.stringify(metadata, null, 2) + "\n",
);
await copyFile("LICENSE", "public/LICENSE.txt");
console.log(
  `Verified ${metadata.tag}: ${metadata.downloads.length} opentu installer artifacts`,
);
