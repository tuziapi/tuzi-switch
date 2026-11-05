import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

export interface WorkflowRecordBase {
  id: string;
  starred?: boolean;
}

export interface WorkflowSyncRecordResult<TRecord extends WorkflowRecordBase> {
  records: TRecord[];
  record: TRecord;
  selectWhenNoCurrent?: boolean;
}

export interface UseWorkflowRecordsOptions<TRecord extends WorkflowRecordBase> {
  loadRecords: () => Promise<TRecord[]>;
  logPrefix?: string;
}

export interface UseWorkflowRecordsResult<TRecord extends WorkflowRecordBase> {
  records: TRecord[];
  setRecords: Dispatch<SetStateAction<TRecord[]>>;
  currentRecord: TRecord | null;
  setCurrentRecord: Dispatch<SetStateAction<TRecord | null>>;
  showStarred: boolean;
  setShowStarred: Dispatch<SetStateAction<boolean>>;
  starredCount: number;
  selectRecord: (record: TRecord) => void;
  updateCurrentRecord: (record: TRecord) => void;
  restart: () => void;
  applySyncedRecord: (synced: WorkflowSyncRecordResult<TRecord>) => void;
}

export function useWorkflowRecords<TRecord extends WorkflowRecordBase>({
  loadRecords,
  logPrefix = '[WorkflowRecords]',
}: UseWorkflowRecordsOptions<TRecord>): UseWorkflowRecordsResult<TRecord> {
  const [records, setRecords] = useState<TRecord[]>([]);
  const [currentRecord, setCurrentRecord] = useState<TRecord | null>(null);
  const [showStarred, setShowStarred] = useState(false);

  useEffect(() => {
    let disposed = false;

    loadRecords()
      .then((loadedRecords) => {
        if (!disposed) {
          setRecords(Array.isArray(loadedRecords) ? loadedRecords : []);
        }
      })
      .catch((error) => {
        console.error(`${logPrefix} Failed to load records:`, error);
        if (!disposed) {
          setRecords([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [loadRecords, logPrefix]);

  const starredCount = useMemo(
    () => records.filter((record) => record.starred).length,
    [records]
  );

  const selectRecord = useCallback((record: TRecord) => {
    setCurrentRecord(record);
  }, []);

  const updateCurrentRecord = useCallback((record: TRecord) => {
    setCurrentRecord(record);
  }, []);

  const restart = useCallback(() => {
    setCurrentRecord(null);
  }, []);

  const applySyncedRecord = useCallback(
    (synced: WorkflowSyncRecordResult<TRecord>) => {
      if (!Array.isArray(synced.records) || !synced.record?.id) {
        return;
      }

      setRecords(synced.records);
      setCurrentRecord((previous) => {
        if (
          previous?.id === synced.record.id ||
          (!previous && synced.selectWhenNoCurrent)
        ) {
          return synced.record;
        }
        return previous;
      });
    },
    []
  );

  return {
    records,
    setRecords,
    currentRecord,
    setCurrentRecord,
    showStarred,
    setShowStarred,
    starredCount,
    selectRecord,
    updateCurrentRecord,
    restart,
    applySyncedRecord,
  };
}
