'use client';

// What every IndexedDB store of the phone's offline data shares
// (today-store.ts, draft-store.ts): a request as a promise, one request in
// its own transaction, and whose data a record is.

/** The signed-in person and the active organization a page was rendered for. */
export type DeviceHolder = { userId: string; organizationId: string };

/** Whether a stored record is of this person in this organization. */
export function belongsTo(record: DeviceHolder, holder: DeviceHolder): boolean {
  return record.userId === holder.userId && record.organizationId === holder.organizationId;
}

/** The request's result; rejects with the request's own error. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Runs one request in its own transaction on `storeName` and resolves with its result once the
 * transaction committed. Rejects with the browser's error when the request or the commit fails:
 * a full disk is a `QuotaExceededError`.
 */
export async function runInStore<T>(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = database.transaction(storeName, mode);
  const committed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
  const [result] = await Promise.all([requestResult(run(transaction.objectStore(storeName))), committed]);
  return result;
}
