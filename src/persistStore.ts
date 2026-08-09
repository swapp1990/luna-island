import type { SaveGame } from './sim/persist'

const DB_NAME = 'luna-island'
const STORE_NAME = 'saves'
const AUTOSAVE_KEY = 'autosave'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

/** Load the autosave blob, or null if missing. */
export async function loadAutosave(): Promise<SaveGame | null> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const raw = await idbReq(store.get(AUTOSAVE_KEY))
      if (raw == null) return null
      return raw as SaveGame
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Persist a full save as the autosave slot. */
export async function putAutosave(save: SaveGame): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    await idbReq(store.put(save, AUTOSAVE_KEY))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB put aborted'))
    })
  } finally {
    db.close()
  }
}

/** Wipe the autosave slot (New World). */
export async function clearAutosave(): Promise<void> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      await idbReq(store.delete(AUTOSAVE_KEY))
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
      })
    } finally {
      db.close()
    }
  } catch {
    // best-effort
  }
}

/** Schedule work during idle time (or next macrotask). */
export function scheduleIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback
  if (typeof ric === 'function') {
    ric(() => fn())
  } else {
    setTimeout(fn, 0)
  }
}
