import type { Task } from '../../../types/task.types';
import { extractJsonValue } from '../../../utils/llm-json-extractor';

export function readTaskAction<TAction extends string>(
  task: Task,
  field: string,
  allowedActions: readonly TAction[]
): TAction | null {
  const action = task.params[field];
  return allowedActions.includes(action as TAction) ? (action as TAction) : null;
}

export function readTaskStringParam(task: Task, field: string): string {
  return String(task.params[field] || '').trim();
}

export function readTaskChatResponse(task: Task): string {
  return String(task.result?.chatResponse || '').trim();
}

export function extractBatchRecordId(
  batchId: string,
  options: {
    prefix: string;
    marker?: string;
  }
): string | null {
  if (!batchId.startsWith(options.prefix)) {
    return null;
  }

  const rest = batchId.slice(options.prefix.length);
  if (!rest) {
    return null;
  }

  if (options.marker) {
    const markerIndex = rest.indexOf(options.marker);
    return markerIndex > 0 ? rest.slice(0, markerIndex) : null;
  }

  const underscoreIndex = rest.indexOf('_');
  return underscoreIndex > 0 ? rest.slice(0, underscoreIndex) : rest;
}

export function parseStructuredOrChatJson<T>(
  task: Task,
  options: {
    missingMessage: string;
    fromStructured: (structured: object) => T;
    fromParsedJson?: (parsed: unknown) => T;
  }
): T {
  const structured = task.result?.analysisData;
  if (structured && typeof structured === 'object') {
    return options.fromStructured(structured);
  }

  const raw = readTaskChatResponse(task);
  if (!raw) {
    throw new Error(options.missingMessage);
  }

  const parsed = extractJsonValue(raw);
  return options.fromParsedJson ? options.fromParsedJson(parsed) : options.fromStructured(parsed as object);
}
