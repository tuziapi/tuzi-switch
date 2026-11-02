import { kvStorageService } from '../../../services/kv-storage-service';

type WorkflowRecordBase = {
  id: string;
  starred: boolean;
};

export interface WorkflowRecordStorageOptions<TRecord> {
  normalizeRecord?: (record: TRecord) => TRecord;
  onPruneRecord?: (record: TRecord) => void | Promise<void>;
  onDeleteRecord?: (record: TRecord) => void | Promise<void>;
}

function normalizeWorkflowRecord<TRecord>(
  record: TRecord,
  options?: WorkflowRecordStorageOptions<TRecord>
): TRecord {
  return options?.normalizeRecord ? options.normalizeRecord(record) : record;
}

function normalizeWorkflowRecords<TRecord>(
  records: TRecord[],
  options?: WorkflowRecordStorageOptions<TRecord>
): TRecord[] {
  const normalizeRecord = options?.normalizeRecord;
  if (!normalizeRecord) {
    return records;
  }
  return records.map((record) => normalizeRecord(record));
}

export async function loadRecordsByKey<TRecord>(
  storageKey: string,
  options?: WorkflowRecordStorageOptions<TRecord>
): Promise<TRecord[]> {
  const records = await kvStorageService.get<TRecord[]>(storageKey);
  return Array.isArray(records) ? normalizeWorkflowRecords(records, options) : [];
}

export async function saveRecordsByKey<TRecord>(
  storageKey: string,
  records: TRecord[],
  options?: WorkflowRecordStorageOptions<TRecord>
): Promise<void> {
  await kvStorageService.set(storageKey, normalizeWorkflowRecords(records, options));
}

export async function addRecordWithCap<TRecord extends WorkflowRecordBase>(
  storageKey: string,
  record: TRecord,
  maxRecords: number,
  options?: WorkflowRecordStorageOptions<TRecord>
): Promise<TRecord[]> {
  const records = await loadRecordsByKey<TRecord>(storageKey, options);
  records.unshift(normalizeWorkflowRecord(record, options));

  while (records.length > maxRecords) {
    let pruneIndex = -1;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (!records[i].starred) {
        pruneIndex = i;
        break;
      }
    }
    if (pruneIndex === -1) {
      break;
    }
    const [removed] = records.splice(pruneIndex, 1);
    await options?.onPruneRecord?.(removed);
  }

  await saveRecordsByKey(storageKey, records, options);
  return records;
}

export async function updateRecordById<TRecord extends WorkflowRecordBase>(
  storageKey: string,
  id: string,
  patch: Partial<TRecord>,
  options?: WorkflowRecordStorageOptions<TRecord>
): Promise<TRecord[]> {
  const records = await loadRecordsByKey<TRecord>(storageKey, options);
  const index = records.findIndex((record) => record.id === id);
  if (index >= 0) {
    records[index] = normalizeWorkflowRecord(
      { ...records[index], ...patch },
      options
    );
    await saveRecordsByKey(storageKey, records, options);
  }
  return records;
}

export async function deleteRecordById<TRecord extends WorkflowRecordBase>(
  storageKey: string,
  id: string,
  options?: WorkflowRecordStorageOptions<TRecord>
): Promise<TRecord[]> {
  const records = await loadRecordsByKey<TRecord>(storageKey, options);
  const target = records.find((record) => record.id === id);
  const filtered = records.filter((record) => record.id !== id);
  await saveRecordsByKey(storageKey, filtered, options);
  if (target) {
    await options?.onDeleteRecord?.(target);
  }
  return filtered;
}
