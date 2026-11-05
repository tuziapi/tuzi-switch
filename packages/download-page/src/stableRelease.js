/* Copyright (C) 2026 Tuzi. Licensed under AGPL-3.0-or-later. */
// Vite injects the same explicit channel used by the metadata build script.
const buildRepository = import.meta.env?.VITE_RELEASE_REPOSITORY;
const nodeRepository =
  typeof process !== "undefined"
    ? process.env.VITE_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY
    : undefined;
export const repository =
  buildRepository || nodeRepository || "tuziapi/tuzi-switch";
if (!["tuziapi/tuzi-switch", "AiW520/tuzi-switch"].includes(repository))
  throw Error("Unsupported download repository");
export const installerFormats = [
  {
    id: "macos",
    title: "macOS",
    subtitle: "Apple Silicon · ARM64",
    format: "DMG",
    file: "tuzi-assistant-macos-arm64.dmg",
  },
  {
    id: "macos-intel",
    title: "macOS",
    subtitle: "Intel · x86_64",
    format: "DMG",
    file: "tuzi-assistant-macos-x64.dmg",
  },
  {
    id: "windows",
    title: "Windows",
    subtitle: "Intel / AMD · x86_64",
    format: "EXE",
    file: "tuzi-assistant-windows-x64.exe",
  },
  {
    id: "msi",
    title: "Windows",
    subtitle: "Intel / AMD · x86_64",
    format: "MSI",
    file: "tuzi-assistant-windows-x64.msi",
  },
  {
    id: "deb",
    title: "Linux",
    subtitle: "Debian / Ubuntu · x86_64",
    format: "DEB",
    file: "tuzi-assistant-linux-x64.deb",
  },
  {
    id: "rpm",
    title: "Linux",
    subtitle: "Fedora / RHEL · x86_64",
    format: "RPM",
    file: "tuzi-assistant-linux-x64.rpm",
  },
  {
    id: "appimage",
    title: "Linux",
    subtitle: "AppImage · x86_64",
    format: "AppImage",
    file: "tuzi-assistant-linux-x64.AppImage",
  },
];
export function isStableRelease(r) {
  if (
    !r ||
    r.schemaVersion !== 2 ||
    r.channel !== "stable" ||
    r.success !== true ||
    r.repository !== repository ||
    !/^v\d+\.\d+\.\d+$/.test(r.tag) ||
    r.sourceUrl !== `https://github.com/${repository}/releases/tag/${r.tag}` ||
    !Number.isFinite(Date.parse(r.publishedAt)) ||
    r.command !== "" ||
    !Array.isArray(r.downloads) ||
    r.downloads.length !== installerFormats.length
  )
    return false;
  return installerFormats.every((p) => {
    const matches = r.downloads.filter((d) => d?.id === p.id);
    const d = matches[0];
    return (
      matches.length === 1 &&
      d.title === p.title &&
      d.subtitle === p.subtitle &&
      d.format === p.format &&
      d.href ===
        `https://github.com/${repository}/releases/download/${r.tag}/${p.file}` &&
      Number.isSafeInteger(d.bytes) &&
      d.bytes > 0 &&
      /^[a-f0-9]{64}$/.test(d.sha256)
    );
  });
}
export function createStableRelease(release) {
  if (
    !release ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  )
    throw Error("Release must be publicly published");
  const r = {
    schemaVersion: 2,
    repository,
    channel: "stable",
    success: true,
    tag: release.tag_name,
    sourceUrl: release.html_url,
    publishedAt: release.published_at,
    command: "",
    stale: false,
    downloads: installerFormats.map((p) => {
      const matches = release.assets.filter((a) => a.name === p.file);
      const a = matches[0];
      if (
        matches.length !== 1 ||
        a.state !== "uploaded" ||
        !/^sha256:[a-f0-9]{64}$/.test(a.digest)
      )
        throw Error(`Missing verified installer: ${p.file}`);
      return {
        id: p.id,
        title: p.title,
        subtitle: p.subtitle,
        format: p.format,
        href: a.browser_download_url,
        bytes: a.size,
        sha256: a.digest.slice(7),
      };
    }),
  };
  if (!isStableRelease(r)) throw Error("Invalid stable release");
  return r;
}
