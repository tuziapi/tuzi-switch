import type { AnalysisRecord, VideoShot } from './types';
import { formatShotsMarkdown } from './types';
import type {
  ExportWorkflowAssetsZipOptions,
  WorkflowExportAssetItem,
  resetWorkflowGeneratedAssets,
} from '../../utils/workflow-generation-utils';
import type { VideoCharacter } from '../../services/video-analysis-service';
import { resetWorkflowGeneratedAssets as buildResetResult } from '../../utils/workflow-generation-utils';
import { formatCreativeBriefSummary } from '../shared/workflow';

export function buildVideoAnalyzerWorkflowExportOptions(
  record: AnalysisRecord,
  shots: VideoShot[],
  assets: WorkflowExportAssetItem[]
): Omit<ExportWorkflowAssetsZipOptions, 'onProgress'> {
  return {
    recordId: record.id,
    fileNamePrefix: 'va',
    zipBaseName: 'video_analyzer_assets',
    scriptMarkdown: formatShotsMarkdown(shots, record.analysis, record.productInfo),
    recordMeta: {
      id: record.id,
      source: record.source,
      sourceLabel: record.sourceLabel,
      prompt: record.productInfo?.prompt || '',
      aspectRatio: record.analysis.aspect_ratio || '16x9',
      videoStyle: record.productInfo?.videoStyle || record.analysis.video_style || '',
      bgmMood: record.productInfo?.bgmMood || record.analysis.bgm_mood || '',
      creativeBrief: record.productInfo?.creativeBrief || {},
      creativeBriefSummary: formatCreativeBriefSummary(record.productInfo?.creativeBrief),
      shotCount: shots.length,
    },
    shots,
    assets,
  };
}

export function buildVideoAnalyzerResetPayload(
  record: Pick<AnalysisRecord, 'characters' | 'analysis'>,
  shots: VideoShot[]
): ReturnType<typeof resetWorkflowGeneratedAssets<VideoShot, VideoCharacter>> {
  const currentCharacters = record.characters || record.analysis.characters || [];
  return buildResetResult(shots, currentCharacters);
}
