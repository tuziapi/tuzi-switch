import { TaskType, type Task } from '../../../types/task.types';
import { updateWorkflowRecord } from './record-sync';

type WorkflowGeneratedClip = {
  clipId: string;
  audioUrl: string;
  imageUrl?: string;
  title?: string;
  duration?: number | null;
  taskId: string;
};

type GeneratedClipRecord = {
  id: string;
  generatedClips?: WorkflowGeneratedClip[];
};

function sanitizeGeneratedClip(clip: WorkflowGeneratedClip): WorkflowGeneratedClip {
  return Object.fromEntries(
    Object.entries(clip).filter(([, value]) => value !== undefined)
  ) as WorkflowGeneratedClip;
}

export function extractGeneratedClipsFromAudioTask(task: Task): WorkflowGeneratedClip[] {
  if (task.type !== TaskType.AUDIO || task.status !== 'completed' || !task.result) {
    return [];
  }

  const clips: WorkflowGeneratedClip[] = [];
  const result = task.result;

  if (Array.isArray(result.clips)) {
    for (const clip of result.clips) {
      if (clip.audioUrl) {
        clips.push(sanitizeGeneratedClip({
          clipId: clip.clipId || clip.id || '',
          audioUrl: clip.audioUrl,
          imageUrl: clip.imageUrl || clip.imageLargeUrl,
          title: clip.title,
          duration: clip.duration ?? null,
          taskId: result.providerTaskId || task.remoteId || task.id,
        }));
      }
    }
  }

  if (clips.length === 0 && result.url) {
    clips.push(sanitizeGeneratedClip({
      clipId: result.primaryClipId || '',
      audioUrl: result.url,
      imageUrl: result.previewImageUrl,
      title: result.title,
      duration: result.duration ?? null,
      taskId: result.providerTaskId || task.remoteId || task.id,
    }));
  }

  return clips;
}

function getGeneratedClipMergeKey(clip: WorkflowGeneratedClip): string {
  const clipId = String(clip.clipId || '').trim();
  return clipId ? `clip:${clipId}` : `audio:${clip.audioUrl}`;
}

export function mergeGeneratedClips(
  existingClips: WorkflowGeneratedClip[],
  incomingClips: WorkflowGeneratedClip[]
): { clips: WorkflowGeneratedClip[]; changed: boolean } {
  const mergedMap = new Map<string, WorkflowGeneratedClip>();
  existingClips.forEach((clip) => {
    mergedMap.set(getGeneratedClipMergeKey(clip), clip);
  });

  let changed = false;
  incomingClips.forEach((clip) => {
    const key = getGeneratedClipMergeKey(clip);
    const existing = mergedMap.get(key);
    if (!existing) {
      mergedMap.set(key, sanitizeGeneratedClip(clip));
      changed = true;
      return;
    }

    const nextClip = sanitizeGeneratedClip({
      ...existing,
      taskId: clip.taskId || existing.taskId,
      clipId: clip.clipId || existing.clipId,
      audioUrl: clip.audioUrl || existing.audioUrl,
      imageUrl: clip.imageUrl ?? existing.imageUrl,
      title: clip.title ?? existing.title,
      duration: clip.duration ?? existing.duration,
    });
    if (JSON.stringify(sanitizeGeneratedClip(existing)) !== JSON.stringify(nextClip)) {
      mergedMap.set(key, nextClip);
      changed = true;
    }
  });

  return {
    clips: Array.from(mergedMap.values()),
    changed,
  };
}

export async function syncGeneratedClipsForRecord<TRecord extends GeneratedClipRecord>(
  task: Task,
  recordId: string,
  options: {
    loadRecords: () => Promise<TRecord[]>;
    updateRecord: (id: string, patch: Partial<TRecord>) => Promise<TRecord[]>;
  }
): Promise<{ records: TRecord[]; record: TRecord } | null> {
  if (task.type !== TaskType.AUDIO || task.status !== 'completed') {
    return null;
  }

  const clips = extractGeneratedClipsFromAudioTask(task);
  if (clips.length === 0) {
    return null;
  }

  const records = await options.loadRecords();
  const target = records.find((record) => record.id === recordId);
  if (!target) {
    return null;
  }

  const merged = mergeGeneratedClips(target.generatedClips || [], clips);
  if (!merged.changed) {
    return { records, record: target };
  }

  return updateWorkflowRecord(target, {
    generatedClips: merged.clips,
  } as Partial<TRecord>, options.updateRecord);
}
