export const previewRepository = "AiW520/tuzi-switch";
export const previewVersion = "1.6.3-beta.5";
export const previewTag = `opentu-preview-v${previewVersion}`;
export const previewPlatforms = [
  {
    id: "macos-arm64",
    label: "macOS · Apple Silicon",
    detail: "M 系列芯片",
    extension: ".dmg",
  },
  {
    id: "macos-x64",
    label: "macOS · Intel",
    detail: "Intel 芯片",
    extension: ".dmg",
  },
  {
    id: "windows-x64",
    label: "Windows · x64",
    detail: "Intel / AMD 64 位",
    extension: ".exe",
  },
  {
    id: "linux-x64",
    label: "Linux · x64",
    detail: "Debian / Ubuntu · AMD64",
    extension: ".deb",
  },
  {
    id: "linux-arm64",
    label: "Linux · ARM64",
    detail: "Debian / Ubuntu · ARM64",
    extension: ".deb",
  },
];
export function isPreviewRelease(value) {
  if (
    !value ||
    value.channel !== "preview" ||
    value.repository !== previewRepository ||
    value.version !== previewVersion ||
    value.tag !== previewTag ||
    value.prerelease !== true ||
    value.applicationId !== "com.tuziswitch.desktop.opentu-preview" ||
    value.automaticUpdates !== false ||
    !/^[a-f0-9]{40}$/.test(value.commit || "") ||
    !Number.isSafeInteger(value.runId) ||
    value.runId <= 0 ||
    !Array.isArray(value.downloads) ||
    value.downloads.length !== previewPlatforms.length
  )
    return false;
  const base = `https://github.com/${previewRepository}/releases/download/${previewTag}/`;
  if (
    value.releaseUrl !==
      `https://github.com/${previewRepository}/releases/tag/${previewTag}` ||
    value.sourceUrl !== `${base}opentu-preview-source-${value.commit}.tar.gz`
  )
    return false;
  return previewPlatforms.every((platform) => {
    const entries = value.downloads.filter(
      (item) => item && item.platform === platform.id,
    );
    if (entries.length !== 1) return false;
    const item = entries[0];
    const name = `OpenTu-Preview-${previewVersion}-${platform.id}${platform.extension}`;
    return (
      item.file === name &&
      item.url === base + name &&
      /^[a-f0-9]{64}$/.test(item.sha256 || "") &&
      Number.isSafeInteger(item.bytes) &&
      item.bytes > 0
    );
  });
}

// Adapt the verified preview manifest to the existing shared download view.
export function previewDownloadRelease(value) {
  if (!isPreviewRelease(value)) throw new Error("Invalid preview release");
  const ids = ["macos", "macos-intel", "windows", "deb", "deb-arm64"];
  return {
    ...value,
    tag: `v${value.version}`,
    sourceUrl: value.releaseUrl,
    correspondingSourceUrl: value.sourceUrl,
    downloads: previewPlatforms.map((platform, index) => {
      const item = value.downloads.find(
        (file) => file.platform === platform.id,
      );
      return {
        id: ids[index],
        title: platform.label,
        subtitle: platform.detail,
        format: platform.extension.slice(1).toUpperCase(),
        href: item.url,
        bytes: item.bytes,
        sha256: item.sha256,
      };
    }),
  };
}
