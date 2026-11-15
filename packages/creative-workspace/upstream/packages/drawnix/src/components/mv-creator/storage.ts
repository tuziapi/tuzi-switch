/**
 * 爆款MV生成器 - 持久化存储
 *
 * 基于共享 workflow record-storage 存储 MV 创作记录。
 * 最多保存 50 条，超出时删除最早的非收藏记录。
 */

import {
  addRecordWithCap,
  deleteRecordById,
  loadRecordsByKey,
  saveRecordsByKey,
  updateRecordById,
} from '../shared/workflow';
import type { MVRecord } from './types';

const STORAGE_KEY = 'mv-creator:records';
const MAX_RECORDS = 50;

export async function loadRecords(): Promise<MVRecord[]> {
  return loadRecordsByKey<MVRecord>(STORAGE_KEY);
}

export async function saveRecords(records: MVRecord[]): Promise<void> {
  await saveRecordsByKey(STORAGE_KEY, records);
}

export async function addRecord(record: MVRecord): Promise<MVRecord[]> {
  return addRecordWithCap(STORAGE_KEY, record, MAX_RECORDS);
}

export async function updateRecord(
  id: string,
  patch: Partial<MVRecord>
): Promise<MVRecord[]> {
  return updateRecordById(STORAGE_KEY, id, patch);
}

export async function deleteRecord(id: string): Promise<MVRecord[]> {
  return deleteRecordById(STORAGE_KEY, id);
}
