import { generateUUID } from '../../utils/runtime-helpers';
import type { Task } from '../../types/task.types';
import {
  migrateProductInfo,
  type AnalysisRecord,
  type AnalysisSourceSnapshot,
  type ProductInfo,
  type VideoAnalysisData,
  type VideoCharacter,
} from './types';
import { addRecord, loadRecords, updateRecord } from './storage';
import {
  parseStructuredOrChatJson,
  readTaskAction,
  readTaskChatResponse,
  readTaskStringParam,
  updateWorkflowRecord,
} from '../shared/workflow';
import {
  addVersionToRecord,
  createScriptVersion,
  parseScriptRewriteResponse,
  type ScriptRewriteParseResult,
} from './utils';

type VideoAnalyzerTaskAction = 'analyze' | 'rewrite' | 'prompt-generate';

function getTaskAction(task: Task): VideoAnalyzerTaskAction | null {
  return readTaskAction(task, 'videoAnalyzerAction', [
    'analyze',
    'rewrite',
    'prompt-generate',
  ] as const);
}

function parseAnalysisResult(task: Task): VideoAnalysisData {
  return parseStructuredOrChatJson(task, {
    missingMessage: '分析任务缺少结果内容',
    fromStructured: (structured) => structured as VideoAnalysisData,
  });
}

function getTaskSourceSnapshot(task: Task): AnalysisSourceSnapshot | null {
  const snapshot = (task.params as { videoAnalyzerSourceSnapshot?: unknown })
    .videoAnalyzerSourceSnapshot as AnalysisSourceSnapshot | undefined;
  if (
    snapshot?.type === 'youtube' ||
    snapshot?.type === 'upload' ||
    snapshot?.type === 'prompt'
  ) {
    return snapshot;
  }

  const source = (task.params as { videoAnalyzerSource?: unknown }).videoAnalyzerSource;
  const sourceLabel = String(
    (task.params as { videoAnalyzerSourceLabel?: unknown }).videoAnalyzerSourceLabel || ''
  ).trim();
  if (source === 'youtube' && sourceLabel) {
    return { type: 'youtube', youtubeUrl: sourceLabel };
  }
  if (source === 'prompt' && sourceLabel) {
    return {
      type: 'prompt',
      prompt: String((task.params as { videoAnalyzerUserPrompt?: unknown }).videoAnalyzerUserPrompt || sourceLabel),
      pdfCacheUrl: readTaskStringParam(task, 'pdfCacheUrl') || undefined,
      pdfName: readTaskStringParam(task, 'pdfName') || undefined,
      pdfMimeType: readTaskStringParam(task, 'pdfMimeType') || undefined,
    };
  }

  return null;
}

function mergeCharactersPreservingReferences(
  base: VideoCharacter[],
  next: VideoCharacter[]
): VideoCharacter[] {
  const baseById = new Map(base.map(character => [character.id, character]));
  return next.map(character => {
    const previous = baseById.get(character.id);
    return {
      ...character,
      referenceImageUrl: character.referenceImageUrl || previous?.referenceImageUrl,
    };
  });
}

function getStructuredRewriteResult(task: Task): ScriptRewriteParseResult | null {
  const structured = task.result?.analysisData as
    | {
        editedShots?: AnalysisRecord['editedShots'];
        shots?: AnalysisRecord['editedShots'];
        characters?: VideoCharacter[];
        video_style?: string;
        videoStyle?: string;
        bgm_mood?: string;
        bgmMood?: string;
        suggestion?: string;
      }
    | undefined;
  const rawShots = Array.isArray(structured?.editedShots)
    ? structured.editedShots
    : Array.isArray(structured?.shots)
    ? structured.shots
    : null;
  if (!structured || !rawShots) {
    return null;
  }

  return {
    shots: rawShots,
    characters: Array.isArray(structured.characters) ? structured.characters : undefined,
    hasCharacters: Object.prototype.hasOwnProperty.call(structured, 'characters'),
    videoStyle: String(structured.video_style || structured.videoStyle || '').trim() || undefined,
    bgmMood: String(structured.bgm_mood || structured.bgmMood || '').trim() || undefined,
    suggestion: String(structured.suggestion || '').trim() || undefined,
  };
}

function getTaskProductInfo(
  task: Task,
  fallbackDuration: number
): ProductInfo | undefined {
  const raw = (task.params as { videoAnalyzerProductInfo?: unknown })
    .videoAnalyzerProductInfo;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  return migrateProductInfo(raw as Partial<ProductInfo>, fallbackDuration);
}

export async function syncVideoAnalyzerTask(task: Task): Promise<{
  records: AnalysisRecord[];
  record: AnalysisRecord;
} | null> {
  if (task.status !== 'completed') {
    return null;
  }

  const action = getTaskAction(task);
  if (!action) {
    return null;
  }

  if (action === 'analyze' || action === 'prompt-generate') {
    const records = await loadRecords();
    const existing = records.find(record => record.analyzeTaskId === task.id);
    if (existing) {
      return { records, record: existing };
    }

    const analysis = parseAnalysisResult(task);
    const sourceSnapshot = getTaskSourceSnapshot(task);
    const rawSource = (task.params as { videoAnalyzerSource?: unknown })
      .videoAnalyzerSource;
    const source = (
      rawSource === 'prompt'
        ? 'prompt'
        : rawSource === 'upload'
        ? 'upload'
        : 'youtube'
    ) as AnalysisRecord['source'];
    const sourceLabel = String(
      (task.params as { videoAnalyzerSourceLabel?: unknown }).videoAnalyzerSourceLabel ||
        (source === 'prompt'
          ? '提示词生成'
          : source === 'youtube'
          ? sourceSnapshot?.type === 'youtube'
            ? sourceSnapshot.youtubeUrl
            : ''
          : '本地视频')
    );
    const productInfo = getTaskProductInfo(task, analysis.totalDuration);

    const record: AnalysisRecord = {
      id: generateUUID(),
      createdAt: Date.now(),
      source,
      sourceLabel,
      sourceSnapshot,
      model: String(task.params.model || ''),
      modelRef: (task.params as { modelRef?: AnalysisRecord['modelRef'] }).modelRef || null,
      analysis,
      ...(productInfo ? { productInfo } : {}),
      starred: false,
      analyzeTaskId: task.id,
    };

    const nextRecords = await addRecord(record);
    return { records: nextRecords, record };
  }

  const recordId = readTaskStringParam(task, 'videoAnalyzerRecordId');
  if (!recordId) {
    return null;
  }

  const records = await loadRecords();
  const target = records.find(record => record.id === recordId);
  if (!target) {
    return null;
  }
  if (target.pendingRewriteTaskId !== task.id) {
    if (
      !target.pendingRewriteTaskId &&
      target.storyboardGeneratedAt &&
      (!task.completedAt || target.storyboardGeneratedAt >= task.completedAt)
    ) {
      return { records, record: target };
    }
    return null;
  }

  const baseShots = target.editedShots || target.analysis.shots;
  const structuredResult = getStructuredRewriteResult(task);
  const rewriteResult = structuredResult
    ? structuredResult
    : (() => {
        const raw = readTaskChatResponse(task);
        if (!raw) {
          throw new Error('脚本改编任务缺少结果内容');
        }
        return parseScriptRewriteResponse(raw, baseShots);
      })();

  const editedShots = rewriteResult.shots;
  const nextCharacters = rewriteResult.hasCharacters
    ? mergeCharactersPreservingReferences(
        target.characters || target.analysis.characters || [],
        rewriteResult.characters || []
      )
    : undefined;
  const nextProductInfo =
    rewriteResult.videoStyle || rewriteResult.bgmMood
      ? {
          ...migrateProductInfo(
            target.productInfo || { prompt: '' },
            target.analysis.totalDuration
          ),
          ...(rewriteResult.videoStyle ? { videoStyle: rewriteResult.videoStyle } : {}),
          ...(rewriteResult.bgmMood ? { bgmMood: rewriteResult.bgmMood } : {}),
        }
      : undefined;
  const nextAnalysis = {
    ...target.analysis,
    suggestion: rewriteResult.suggestion || '',
  };

  const versionLabel = `AI 改编 #${(target.scriptVersions?.length || 0) + 1}`;
  const version = createScriptVersion(editedShots, versionLabel, target.productInfo?.prompt, {
    characters: nextCharacters || target.characters || target.analysis.characters || [],
    productInfo: nextProductInfo || target.productInfo,
  });
  const versionPatch = addVersionToRecord(target, version);

  return updateWorkflowRecord(target, {
    ...versionPatch,
    analysis: nextAnalysis,
    ...(nextCharacters !== undefined ? { characters: nextCharacters } : {}),
    ...(nextProductInfo ? { productInfo: nextProductInfo } : {}),
    pendingRewriteTaskId: null,
    storyboardGeneratedAt: Date.now(),
  }, updateRecord);
}

export function isVideoAnalyzerTask(task: Task): boolean {
  return getTaskAction(task) !== null;
}
