// Owner: Pablo. Keeps screen recordings in IndexedDB so any tab on this origin
// (Work Map, tutor, ERP) can replay them. No server route needed for a one-laptop demo.

const DB_NAME = "understudy";
const STORE = "recordings";

interface StoredRecording {
  id: string;
  blob: Blob;
  saved_at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Store a recording under its session id (e.g. the SessionLog id). */
export async function saveRecording(id: string, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put({ id, blob, saved_at: Date.now() } satisfies StoredRecording));
}

/** A recording by session id, or the newest one when no id is given. */
export async function loadRecording(id?: string): Promise<Blob | null> {
  try {
    if (id) return (await run<StoredRecording | undefined>("readonly", (s) => s.get(id)))?.blob ?? null;
    const all = await run<StoredRecording[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.saved_at - a.saved_at)[0]?.blob ?? null;
  } catch (err) {
    console.warn("[recordings] could not load:", err);
    return null;
  }
}

/** Delete every stored recording. Used by the demo reset. */
export async function clearRecordings(): Promise<void> {
  await run("readwrite", (s) => s.clear());
}
