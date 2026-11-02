import type { VideoCharacter, VideoShot } from '../services/video-analysis-service';

export interface WorkflowExportAssetItem {
  url: string;
  type: 'image' | 'video';
  kind: 'first' | 'last' | 'video';
  shotIndex: number;
}

export interface WorkflowExportAudioAsset {
  url: string;
  fallbackExtension?: string;
  plannedFileName?: string;
  missingErrorMessage?: string;
  downloadErrorMessage?: string;
}

export interface WorkflowExportShotManifest {
  index: number;
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  files: {
    first: string | null;
    last: string | null;
    video: string | null;
  };
}

export interface WorkflowExportManifest {
  exportedAt: string;
  record: Record<string, unknown>;
  files: {
    script: string;
    music: string | null;
    manifest: string;
    downloadScript: string;
  };
  shots: WorkflowExportShotManifest[];
  errors: string[];
  downloadEntries: Array<{ fileName: string; url: string }>;
}

export interface ExportWorkflowAssetsZipOptions {
  recordId: string;
  fileNamePrefix: string;
  zipBaseName: string;
  scriptMarkdown: string;
  recordMeta: Record<string, unknown>;
  shots: VideoShot[];
  assets: WorkflowExportAssetItem[];
  audioAsset?: WorkflowExportAudioAsset | null;
  onProgress?: (progress: number) => void;
}

export interface ExportWorkflowAssetsZipResult {
  assetCount: number;
  zipFileName: string;
}

export function getWorkflowExportIndexWidth(shotCount: number): number {
  return Math.max(2, String(Math.max(shotCount, 0)).length);
}

export function getWorkflowExportPrefix(index: number, width: number): string {
  return String(index).padStart(width, '0');
}

export function getWorkflowExportBaseName(
  shotIndex: number,
  kind: WorkflowExportAssetItem['kind'],
  width: number
): string {
  const prefix = getWorkflowExportPrefix(shotIndex + 1, width);
  if (kind === 'first') return `${prefix}.首帧`;
  if (kind === 'last') return `${prefix}.尾帧`;
  return `${prefix}.视频`;
}

export function buildWorkflowDownloadScript(
  manifestFileName: string
): string {
  const shellDollar = '$';
  return [
    '#!/bin/sh',
    'set -eu',
    '',
    'cd "$(dirname "$0")"',
    '',
    `MANIFEST_FILE=${JSON.stringify(manifestFileName)}`,
    '',
    'if [ ! -f "$MANIFEST_FILE" ]; then',
    '  echo "未找到 $MANIFEST_FILE"',
    '  exit 1',
    'fi',
    '',
    'download_if_missing() {',
    '  file_name="$1"',
    '  source_url="$2"',
    '  if [ -s "$file_name" ]; then',
    '    echo "[skip] $file_name"',
    '    return 0',
    '  fi',
    '  echo "[download] $file_name"',
    '  curl -L --fail --retry 3 --retry-delay 1 --output "$file_name.part" "$source_url"',
    '  mv "$file_name.part" "$file_name"',
    '}',
    '',
    'emit_entries() {',
    '  if command -v node >/dev/null 2>&1; then',
    '    node -e \'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for (const entry of manifest.downloadEntries||[]) { if (entry?.fileName && entry?.url) process.stdout.write(String(entry.fileName)+"\\t"+String(entry.url)+"\\n"); }\' "$MANIFEST_FILE"',
    '    return 0',
    '  fi',
    '',
    '  if command -v python3 >/dev/null 2>&1; then',
    "    python3 - \"$MANIFEST_FILE\" <<'PY'",
    'import json, sys',
    "with open(sys.argv[1], 'r', encoding='utf-8') as fh:",
    '    manifest = json.load(fh)',
    "for entry in manifest.get('downloadEntries', []):",
    "    file_name = entry.get('fileName')",
    "    url = entry.get('url')",
    '    if file_name and url:',
    "        print(f\"{file_name}\\t{url}\")",
    'PY',
    '    return 0',
    '  fi',
    '',
    '  echo "需要 node 或 python3 来解析 $MANIFEST_FILE" >&2',
    '  return 1',
    '}',
    '',
    'TMP_ENTRIES_FILE="$(mktemp -t workflow-download-entries.XXXXXX)"',
    'trap \'rm -f "$TMP_ENTRIES_FILE"\' EXIT INT TERM',
    '',
    'emit_entries > "$TMP_ENTRIES_FILE"',
    '',
    'while IFS=\'\t\' read -r file_name source_url; do',
    `  [ -n "${shellDollar}{file_name:-}" ] || continue`,
    `  [ -n "${shellDollar}{source_url:-}" ] || continue`,
    '  download_if_missing "$file_name" "$source_url"',
    'done < "$TMP_ENTRIES_FILE"',
    '',
    'echo "下载完成"',
    '',
  ].join('\n');
}

export function resetGeneratedShots<T extends VideoShot>(shots: T[]): T[] {
  return shots.map(shot => ({
    ...shot,
    generated_first_frame_url: undefined,
    generated_last_frame_url: undefined,
    generated_video_url: undefined,
    suppressed_generated_urls: getResetSuppressedGeneratedUrls(shot),
  }));
}

function getResetSuppressedGeneratedUrls<T extends VideoShot>(
  shot: T
): T['suppressed_generated_urls'] {
  const suppressed = {
    ...(shot.suppressed_generated_urls || {}),
  } as NonNullable<T['suppressed_generated_urls']>;

  if (shot.generated_first_frame_url) {
    suppressed.first = shot.generated_first_frame_url;
  }
  if (shot.generated_last_frame_url) {
    suppressed.last = shot.generated_last_frame_url;
  }
  if (shot.generated_video_url) {
    suppressed.video = shot.generated_video_url;
  }

  return Object.keys(suppressed).length > 0 ? suppressed : undefined;
}

export function resetCharacterReferenceImages<T extends VideoCharacter>(characters: T[]): T[] {
  return characters.map(character => ({
    ...character,
    referenceImageUrl: undefined,
  }));
}

export function resetWorkflowGeneratedAssets<
  TShot extends VideoShot,
  TCharacter extends VideoCharacter,
>(shots: TShot[], characters: TCharacter[]) {
  return {
    shots: resetGeneratedShots(shots),
    characters: resetCharacterReferenceImages(characters),
  };
}

export function collectWorkflowExportAssets<TShot extends VideoShot>(
  shots: TShot[]
): WorkflowExportAssetItem[] {
  return shots.flatMap((shot, index) => {
    const items: WorkflowExportAssetItem[] = [];
    if (shot.generated_first_frame_url) {
      items.push({
        url: shot.generated_first_frame_url,
        type: 'image',
        kind: 'first',
        shotIndex: index,
      });
    }
    if (shot.generated_last_frame_url) {
      items.push({
        url: shot.generated_last_frame_url,
        type: 'image',
        kind: 'last',
        shotIndex: index,
      });
    }
    if (shot.generated_video_url) {
      items.push({
        url: shot.generated_video_url,
        type: 'video',
        kind: 'video',
        shotIndex: index,
      });
    }
    return items;
  });
}

export async function exportWorkflowAssetsZip(
  options: ExportWorkflowAssetsZipOptions
): Promise<ExportWorkflowAssetsZipResult> {
  const {
    recordId,
    fileNamePrefix,
    zipBaseName,
    scriptMarkdown,
    recordMeta,
    shots,
    assets,
    audioAsset,
    onProgress,
  } = options;
  const exportedAt = new Date().toISOString();
  const shotIndexWidth = getWorkflowExportIndexWidth(shots.length);
  const zeroPrefix = getWorkflowExportPrefix(0, shotIndexWidth);
  const { default: JSZip } = await import('jszip');
  const {
    downloadFromBlob,
    getFileExtension,
    normalizeImageDataUrl,
    processBatchWithConcurrency,
  } = await import('@aitu/utils');
  const { unifiedCacheService } = await import(
    '../services/unified-cache-service'
  );
  const loadBlob = async (url: string): Promise<Blob> => {
    const blob = await unifiedCacheService.getCachedBlob(url);
    if (blob) return blob;
    if (/^https?:\/\//i.test(url)) {
      const response = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (response.ok) return response.blob();
    }
    throw new Error('未找到可用缓存，且网络下载失败');
  };
  const zip = new JSZip();
  const manifest: WorkflowExportManifest = {
    exportedAt,
    record: recordMeta,
    files: {
      script: `${zeroPrefix}.脚本.md`,
      music: null,
      manifest: `${zeroPrefix}.manifest.json`,
      downloadScript: `${zeroPrefix}.补全下载.sh`,
    },
    shots: shots.map((shot, index) => ({
      index: index + 1,
      id: shot.id,
      label: shot.label || `镜头 ${index + 1}`,
      startTime: shot.startTime,
      endTime: shot.endTime,
      files: {
        first: null,
        last: null,
        video: null,
      },
    })),
    errors: [],
    downloadEntries: [],
  };

  zip.file(manifest.files.script, scriptMarkdown);
  onProgress?.(assets.length > 0 || audioAsset ? 8 : 40);

  if (audioAsset?.url) {
    const plannedFileName = audioAsset.plannedFileName || `${zeroPrefix}.音乐.mp3`;
    manifest.downloadEntries.push({
      fileName: plannedFileName,
      url: audioAsset.url,
    });
    try {
      const blob = await loadBlob(audioAsset.url);
      const detectedExt = getFileExtension(audioAsset.url, blob.type);
      const ext = detectedExt !== 'bin'
        ? detectedExt
        : audioAsset.fallbackExtension || 'mp3';
      const resolvedFileName = plannedFileName.replace(/\.[^.]+$/, `.${ext}`);
      zip.file(resolvedFileName, blob);
      manifest.files.music = resolvedFileName;
      if (resolvedFileName !== plannedFileName) {
        manifest.downloadEntries[manifest.downloadEntries.length - 1].fileName = resolvedFileName;
      }
    } catch (error) {
      manifest.files.music = plannedFileName;
      manifest.errors.push(audioAsset.downloadErrorMessage || '音乐下载失败');
      console.error('[workflow-export] Failed to export audio asset:', audioAsset.url, error);
    }
  } else if (audioAsset?.missingErrorMessage) {
    manifest.errors.push(audioAsset.missingErrorMessage);
  }

  await processBatchWithConcurrency(
    assets,
    async (asset, processedIndex) => {
      const assetUrl = asset.type === 'image' ? normalizeImageDataUrl(asset.url) : asset.url;
      const shotManifest = manifest.shots[asset.shotIndex];
      const fallbackExt = asset.type === 'image' ? 'png' : 'mp4';
      const plannedFilePath = `${getWorkflowExportBaseName(asset.shotIndex, asset.kind, shotIndexWidth)}.${fallbackExt}`;
      manifest.downloadEntries.push({
        fileName: plannedFilePath,
        url: assetUrl,
      });
      try {
        const blob = await loadBlob(assetUrl);
        const detectedExt = getFileExtension(assetUrl, blob.type);
        const ext = detectedExt !== 'bin' ? detectedExt : fallbackExt;
        const filePath = `${getWorkflowExportBaseName(asset.shotIndex, asset.kind, shotIndexWidth)}.${ext}`;
        zip.file(filePath, blob);
        shotManifest.files[asset.kind] = filePath;
        if (filePath !== plannedFilePath) {
          manifest.downloadEntries[manifest.downloadEntries.length - 1].fileName = filePath;
        }
      } catch (error) {
        const shotLabel = shotManifest?.label || `镜头 ${asset.shotIndex + 1}`;
        manifest.errors.push(`${shotLabel} ${asset.kind} 下载失败`);
        shotManifest.files[asset.kind] = plannedFilePath;
        console.error('[workflow-export] Failed to export asset:', assetUrl, error);
      } finally {
        const completed = processedIndex + 1;
        const assetProgress = assets.length > 0
          ? Math.round((completed / assets.length) * 62)
          : 62;
        onProgress?.(8 + assetProgress);
      }
    },
    3
  );

  zip.file(
    manifest.files.downloadScript,
    buildWorkflowDownloadScript(manifest.files.manifest),
    { unixPermissions: 0o755 }
  );
  zip.file(manifest.files.manifest, JSON.stringify(manifest, null, 2));

  const zipBlob = await zip.generateAsync(
    { type: 'blob' },
    metadata => onProgress?.(70 + Math.round(metadata.percent * 0.3))
  );
  const safeRecordId = recordId.replace(/[^a-zA-Z0-9_-]/g, '');
  const timestamp = exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  const zipFileName = `${zipBaseName}_${safeRecordId || fileNamePrefix}_${timestamp}.zip`;
  downloadFromBlob(zipBlob, zipFileName);
  onProgress?.(100);

  return {
    assetCount: assets.length,
    zipFileName,
  };
}
