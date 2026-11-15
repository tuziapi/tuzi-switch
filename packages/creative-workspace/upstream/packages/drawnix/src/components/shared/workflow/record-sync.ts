type WorkflowRecordWithId = {
  id: string;
};

export async function updateWorkflowRecord<TRecord extends WorkflowRecordWithId>(
  target: TRecord,
  patch: Partial<TRecord>,
  updateRecord: (id: string, patch: Partial<TRecord>) => Promise<TRecord[]>
): Promise<{ records: TRecord[]; record: TRecord }> {
  const nextRecords = await updateRecord(target.id, patch);
  return {
    records: nextRecords,
    record: nextRecords.find((record) => record.id === target.id) || ({
      ...target,
      ...patch,
    } as TRecord),
  };
}
