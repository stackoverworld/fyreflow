export interface StorageSyncLock {
  runExclusive<T>(operation: () => T): T;
}

export const noOpStorageLock: StorageSyncLock = {
  runExclusive: <T>(operation: () => T): T => operation()
};

export function withStorageLock<T>(operation: () => T): T {
  return noOpStorageLock.runExclusive(operation);
}
