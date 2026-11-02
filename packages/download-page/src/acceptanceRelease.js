/* Copyright (C) 2026 Tuzi. Licensed under AGPL-3.0-or-later. */
export const ACCEPTANCE_REPOSITORY = "AiW520/tuzi-switch";
const runBase = `https://github.com/${ACCEPTANCE_REPOSITORY}/actions/runs/`;
export const acceptancePlatforms = [
  {
    id: "macos",
    target: "macos-arm64",
    title: "macOS",
    subtitle: "Apple Silicon · ARM64",
    contents: "ZIP · 内含 DMG",
  },
  {
    id: "macos-intel",
    target: "macos-x64",
    title: "macOS",
    subtitle: "Intel · x86_64",
    contents: "ZIP · 内含 DMG",
  },
  {
    id: "windows",
    target: "windows-x64",
    title: "Windows",
    subtitle: "Intel / AMD · x86_64",
    contents: "ZIP · 内含 EXE / MSI",
  },
  {
    id: "linux",
    target: "linux-x64",
    title: "Linux",
    subtitle: "Intel / AMD · x86_64",
    contents: "ZIP · 内含 DEB / RPM / AppImage",
  },
];
export function isAcceptanceRelease(value, now = Date.now()) {
  if (
    !value?.success ||
    value.channel !== "acceptance" ||
    !/^\d+$/.test(value.runId || "") ||
    !/^[a-f0-9]{40}$/.test(value.commit || "") ||
    value.tag !== `test-${value.commit.slice(0, 8)}` ||
    value.command !== "" ||
    value.sourceUrl !== `${runBase}${value.runId}` ||
    !Array.isArray(value.downloads) ||
    value.downloads.length !== acceptancePlatforms.length
  )
    return false;
  return (
    acceptancePlatforms.every((platform) => {
      const matches = value.downloads.filter(
        (item) => item?.id === platform.id,
      );
      if (matches.length !== 1) return false;
      const item = matches[0];
      return (
        /^\d+$/.test(item.artifactId || "") &&
        item.href === `${value.sourceUrl}/artifacts/${item.artifactId}` &&
        item.title === platform.title &&
        item.subtitle === platform.subtitle &&
        item.contents === platform.contents &&
        Date.parse(item.expiresAt) > now
      );
    }) &&
    new Set(value.downloads.map((item) => item.artifactId)).size ===
      acceptancePlatforms.length
  );
}
export function createAcceptanceRelease(pin, run, artifacts, now = Date.now()) {
  if (!pin || !/^\d+$/.test(pin.runId) || !/^[a-f0-9]{40}$/.test(pin.commit))
    throw new Error("Invalid acceptance pin");
  if (
    String(run.id) !== pin.runId ||
    run.head_sha !== pin.commit ||
    run.repository?.full_name !== ACCEPTANCE_REPOSITORY ||
    run.path !== ".github/workflows/acceptance-build.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    throw new Error(
      "Acceptance run is not the pinned successful installer build",
    );
  const sourceUrl = `${runBase}${pin.runId}`;
  const downloads = acceptancePlatforms.map((platform) => {
    const matches = artifacts.filter(
      (item) => item.name === `tuzi-assistant-${platform.target}-${pin.commit}`,
    );
    const item = matches[0];
    if (
      matches.length !== 1 ||
      item.expired ||
      !(item.size_in_bytes > 0) ||
      item.workflow_run?.id !== run.id ||
      item.workflow_run?.head_sha !== pin.commit
    )
      throw new Error(`Missing or mismatched installer: ${platform.target}`);
    return {
      id: platform.id,
      title: platform.title,
      subtitle: platform.subtitle,
      contents: platform.contents,
      artifactId: String(item.id),
      expiresAt: item.expires_at,
      href: `${sourceUrl}/artifacts/${item.id}`,
    };
  });
  const metadata = {
    success: true,
    channel: "acceptance",
    runId: pin.runId,
    commit: pin.commit,
    tag: `test-${pin.commit.slice(0, 8)}`,
    sourceUrl,
    command: "",
    stale: false,
    downloads,
  };
  if (!isAcceptanceRelease(metadata, now))
    throw new Error("Invalid or expired acceptance installers");
  return metadata;
}
