/**
 * 爆款MV生成器 - 任务同步
 */

import type { Task } from '../../types/task.types';
import { TaskType } from '../../types/task.types';
import {
  collectJsonObjects,
  extractJsonArray,
  extractJsonObject,
} from '../../utils/llm-json-extractor';
import type { MVRecord, VideoShot, VideoCharacter } from './types';
import { loadRecords, updateRecord } from './storage';
import { addStoryboardVersionToRecord, createStoryboardVersion } from './utils';
import { parseScriptRewriteResponse } from '../video-analyzer/utils';
import {
  extractBatchRecordId,
  readTaskAction,
  readTaskChatResponse,
  readTaskStringParam,
  syncGeneratedClipsForRecord,
  updateWorkflowRecord,
} from '../shared/workflow';

// ── 分镜规划任务 ──

function getMVCreatorAction(task: Task): 'storyboard' | 'rewrite' | null {
  return readTaskAction(task, 'mvCreatorAction', ['storyboard', 'rewrite'] as const);
}

export function isMVCreatorTask(task: Task): boolean {
  return getMVCreatorAction(task) !== null;
}

function parseStoryboardResult(task: Task): { shots: VideoShot[]; characters: VideoCharacter[] } {
  const chatResponse = readTaskChatResponse(task);
  if (!chatResponse) throw new Error('分镜任务缺少结果内容');

  // 尝试新格式：{ characters: [...], shots: [...] }
  try {
    const parsed = extractJsonObject<{
      shots?: VideoShot[];
      characters?: VideoCharacter[];
    }>(
      chatResponse,
      value => Array.isArray((value as { shots?: unknown }).shots)
    );
    const shots = (parsed.shots || []).map((s, i) => ({
      ...s,
      id: s.id || `shot_${i + 1}`,
    }));
    const characters = Array.isArray(parsed.characters) ? parsed.characters : [];
    return { shots, characters };
  } catch {
    // Fall through to legacy array-only contract.
  }

  // 纯 JSON 数组
  try {
    const shots = extractJsonArray<VideoShot>(
      chatResponse,
      value => Array.isArray(value) && value.some(item => item && typeof item === 'object')
    ).map((s, i) => ({
      ...s,
      id: s.id || `shot_${i + 1}`,
    }));
    return { shots, characters: [] };
  } catch {
    // Fall through to partial extraction.
  }

  // 截断兜底：逐个提取完整的 JSON 对象
  const objects: VideoShot[] = [];
  const characters: VideoCharacter[] = [];
  const partialObjects = collectJsonObjects<Record<string, unknown>>(
    chatResponse,
    value => {
      const obj = value as Record<string, unknown>;
      return typeof obj.id === 'string' || obj.startTime !== undefined;
    }
  );
  for (const obj of partialObjects) {
    const id = typeof obj.id === 'string' ? obj.id : '';
    if (id.startsWith('char_') && obj.name && obj.description) {
      characters.push(obj as unknown as VideoCharacter);
    } else if (id.startsWith('shot_') || obj.startTime !== undefined) {
      objects.push({
        ...obj,
        id: id || `shot_${objects.length + 1}`,
      } as unknown as VideoShot);
    }
  }

  if (objects.length > 0) return { shots: objects, characters };
  throw new Error('响应中未找到有效 JSON（可能因输出过长被截断）');
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

export async function syncMVStoryboardTask(task: Task): Promise<{
  records: MVRecord[];
  record: MVRecord;
} | null> {
  if (task.status !== 'completed' || getMVCreatorAction(task) !== 'storyboard') {
    return null;
  }

  const recordId = readTaskStringParam(task, 'mvCreatorRecordId');
  if (!recordId) return null;

  const records = await loadRecords();
  const target = records.find(r => r.id === recordId);
  if (!target || target.pendingStoryboardTaskId !== task.id) return null;

  const { shots, characters } = parseStoryboardResult(task);
  const versionCount = (target.storyboardVersions || []).length;
  const version = createStoryboardVersion(
    shots,
    `AI 分镜 #${versionCount + 1}`,
    (task.params as { prompt?: string }).prompt,
    {
      characters,
      videoStyle: target.videoStyle,
    }
  );
  const versionPatch = addStoryboardVersionToRecord(target, version);

  return updateWorkflowRecord(target, {
    editedShots: shots,
    pendingStoryboardTaskId: null,
    storyboardGeneratedAt: Date.now(),
    ...(characters.length > 0 ? { characters } : {}),
    ...versionPatch,
  }, updateRecord);
}

// ── 脚本改编任务 ──

export async function syncMVRewriteTask(task: Task): Promise<{
  records: MVRecord[];
  record: MVRecord;
} | null> {
  if (task.status !== 'completed' || getMVCreatorAction(task) !== 'rewrite') {
    return null;
  }

  const recordId = readTaskStringParam(task, 'mvCreatorRecordId');
  if (!recordId) return null;

  const records = await loadRecords();
  const target = records.find(r => r.id === recordId);
  if (!target) return null;
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

  const chatResponse = readTaskChatResponse(task);
  if (!chatResponse) {
    return null;
  }

  const currentShots = target.editedShots || [];
  const rewriteResult = parseScriptRewriteResponse(chatResponse, currentShots);
  const newShots = rewriteResult.shots;
  const updatedCharacters = rewriteResult.characters;
  const hasCharacters = rewriteResult.hasCharacters;
  const updatedVideoStyle = rewriteResult.videoStyle;

  const versionCount = (target.storyboardVersions || []).length;
  const version = createStoryboardVersion(
    newShots,
    `AI 改编 #${versionCount + 1}`,
    (task.params as { prompt?: string }).prompt,
    {
      characters: hasCharacters
        ? mergeCharactersPreservingReferences(target.characters || [], updatedCharacters || [])
        : target.characters || [],
      videoStyle: updatedVideoStyle || target.videoStyle,
    }
  );
  const versionPatch = addStoryboardVersionToRecord(target, version);
  const nextCharacters = hasCharacters
    ? mergeCharactersPreservingReferences(target.characters || [], updatedCharacters || [])
    : undefined;

  return updateWorkflowRecord(target, {
    editedShots: newShots,
    pendingRewriteTaskId: null,
    storyboardGeneratedAt: Date.now(),
    ...(nextCharacters !== undefined ? { characters: nextCharacters } : {}),
    ...(updatedVideoStyle ? { videoStyle: updatedVideoStyle } : {}),
    ...versionPatch,
  }, updateRecord);
}

// ── 音乐生成任务 ──

export function getMVMusicRecordId(task: Task): string | null {
  if (task.type !== TaskType.AUDIO) return null;
  const batchId = (task.params as { batchId?: string }).batchId;
  if (!batchId) return null;
  return extractBatchRecordId(batchId, {
    prefix: 'mv_',
    marker: '_music_',
  });
}

export async function syncMVMusicTask(
  task: Task,
  recordId: string
): Promise<{ records: MVRecord[]; record: MVRecord } | null> {
  return syncGeneratedClipsForRecord(task, recordId, {
    loadRecords,
    updateRecord,
  });
}
