import type { MVRecord, VideoShot } from './types';
import { formatMVShotsMarkdown } from './utils';
import type {
  ExportWorkflowAssetsZipOptions,
  WorkflowExportAssetItem,
  resetWorkflowGeneratedAssets,
} from '../../utils/workflow-generation-utils';
import type { VideoCharacter } from '../../services/video-analysis-service';
import { resetWorkflowGeneratedAssets as buildResetResult } from '../../utils/workflow-generation-utils';
import { formatCreativeBriefSummary } from '../shared/workflow';

export function buildMVWorkflowExportOptions(
  record: MVRecord,
  shots: VideoShot[],
  assets: WorkflowExportAssetItem[]
): Omit<ExportWorkflowAssetsZipOptions, 'onProgress'> {
  const selectedAudioUrl =
    record.selectedClipAudioUrl ||
    record.generatedClips?.find((clip) => clip.clipId === record.selectedClipId)?.audioUrl ||
    null;

  return {
    recordId: record.id,
    fileNamePrefix: 'mv',
    zipBaseName: 'mv_assets',
    scriptMarkdown: formatMVShotsMarkdown(record, shots),
    recordMeta: {
      id: record.id,
      musicTitle: record.musicTitle || '',
      musicStyleTags: record.musicStyleTags || [],
      aspectRatio: record.aspectRatio || '16x9',
      videoStyle: record.videoStyle || '',
      creativeBrief: record.creativeBrief || {},
      creativeBriefSummary: formatCreativeBriefSummary(record.creativeBrief),
      shotCount: shots.length,
    },
    shots,
    assets,
    audioAsset: selectedAudioUrl
      ? {
          url: selectedAudioUrl,
          fallbackExtension: 'mp3',
          downloadErrorMessage: '音乐下载失败',
        }
      : {
          url: '',
          missingErrorMessage: '缺少已选中的音乐文件',
        },
  };
}

export function buildMVResetPayload(
  record: Pick<MVRecord, 'characters'>,
  shots: VideoShot[]
): ReturnType<typeof resetWorkflowGeneratedAssets<VideoShot, VideoCharacter>> {
  return buildResetResult(shots, record.characters || []);
}
