import type { Task } from '../../../types/task.types';

export function findRecordIdFromBatch(
  batchId: string,
  batchPrefix: string,
  recordIds: Iterable<string>
): string | null {
  if (!batchId.startsWith(batchPrefix)) {
    return null;
  }

  const rest = batchId.slice(batchPrefix.length);
  for (const recordId of recordIds) {
    if (rest === recordId || rest.startsWith(`${recordId}_`)) {
      return recordId;
    }
  }

  return null;
}

export function appendTaskToRelatedGroup<TGroup extends string>(
  map: Map<string, Record<TGroup, Task[]>>,
  recordId: string,
  group: TGroup,
  task: Task,
  createEmptyGroups: () => Record<TGroup, Task[]>
): void {
  if (!map.has(recordId)) {
    map.set(recordId, createEmptyGroups());
  }

  map.get(recordId)![group].push(task);
}

export function sortRelatedTaskGroups<TGroup extends string>(
  map: Map<string, Record<TGroup, Task[]>>
): Map<string, Record<TGroup, Task[]>> {
  for (const related of map.values()) {
    for (const group of Object.keys(related) as TGroup[]) {
      related[group].sort((a, b) => b.createdAt - a.createdAt);
    }
  }

  return map;
}
