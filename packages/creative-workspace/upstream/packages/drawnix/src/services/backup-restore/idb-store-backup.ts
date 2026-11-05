/**
 * Small IndexedDB helpers for backup/restore.
 * Uses cursors and batched writes to avoid large getAll/putAll spikes.
 */

export interface StoreRecord<T = unknown> {
  key: IDBValidKey;
  value: T;
}

export async function readStoreRecords<T = unknown>(
  dbName: string,
  storeName: string,
  batchYieldSize = 200
): Promise<StoreRecord<T>[]> {
  const db = await openExistingDatabase(dbName);
  if (!db || !db.objectStoreNames.contains(storeName)) {
    db?.close();
    return [];
  }

  try {
    return await new Promise<StoreRecord<T>[]>((resolve, reject) => {
      const records: StoreRecord<T>[] = [];
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.openCursor();
      let seen = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(records);
          return;
        }
        records.push({ key: cursor.primaryKey, value: cursor.value as T });
        seen += 1;
        if (seen % batchYieldSize === 0) {
          setTimeout(() => cursor.continue(), 0);
          return;
        }
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function writeStoreRecords<T = unknown>(
  dbName: string,
  storeName: string,
  records: StoreRecord<T>[],
  batchSize = 200,
  options: { useStoredKey?: boolean } = {}
): Promise<number> {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  let written = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const db = await openExistingDatabase(dbName);
    if (!db || !db.objectStoreNames.contains(storeName)) {
      db?.close();
      break;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const record of batch) {
          if (record && 'key' in record) {
            try {
              if (options.useStoredKey) {
                store.put(record.value as any, record.key);
              } else {
                store.put(record.value as any);
              }
            } catch {
              // Invalid external records are skipped by design.
            }
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      written += batch.length;
    } finally {
      db.close();
    }

    await yieldToMainThread();
  }

  return written;
}

export async function clearStore(
  dbName: string,
  storeName: string
): Promise<void> {
  const db = await openExistingDatabase(dbName);
  if (!db || !db.objectStoreNames.contains(storeName)) {
    db?.close();
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).clear();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteStoreRecord(
  dbName: string,
  storeName: string,
  key: IDBValidKey
): Promise<void> {
  const db = await openExistingDatabase(dbName);
  if (!db || !db.objectStoreNames.contains(storeName)) {
    db?.close();
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).delete(key);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function countStore(
  dbName: string,
  storeName: string
): Promise<number> {
  const db = await openExistingDatabase(dbName);
  if (!db || !db.objectStoreNames.contains(storeName)) {
    db?.close();
    return 0;
  }

  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function openExistingDatabase(dbName: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
