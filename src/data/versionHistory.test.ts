import { describe, expect, it } from "vitest";
import { productReleases } from "./versionHistory";

const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

describe("productReleases", () => {
  it("保持版本标识、来源与内容完整", () => {
    const versions = productReleases.map((release) => release.version);

    expect(new Set(versions).size).toBe(versions.length);
    for (const release of productReleases) {
      expect(release.version).toMatch(SEMVER_TAG);
      expect(release.publishedAt).toMatch(ISO_DATE);
      expect(release.commit).toMatch(COMMIT_SHA);
      expect(release.releaseUrl).toBe(
        `https://github.com/tuziapi/tuzi-switch/releases/tag/${release.version}`,
      );
      expect(release.changes.length).toBeGreaterThan(0);
      expect(
        release.changes.every((change) => change.title.trim().length > 0),
      ).toBe(true);
    }
  });

  it("按发布日期倒序排列", () => {
    const dates = productReleases.map((release) => release.publishedAt);
    expect(dates).toEqual(
      [...dates].sort((left, right) => right.localeCompare(left)),
    );
  });
});
