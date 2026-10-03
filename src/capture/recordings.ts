// Owner: Pablo. Keeps screen recordings in IndexedDB so any tab on this origin
// (Work Map, tutor, ERP) can replay them. No server route needed for a one-laptop demo.

const DB_NAME = "understudy";
const STORE = "recordings";

/** A span taken off the record, in ms since the session started. */
export interface Cut {
  from: number;
  to: number;
}

export interface Recording {
  blob: Blob;
  /** Off-the-record spans. The video has no footage for them, so later moments sit earlier in the file. */
  cuts: Cut[];
}

interface StoredRecording extends Recording {
  id: string;
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
export async function saveRecording(id: string, blob: Blob, cuts: Cut[] = []): Promise<void> {
  await run("readwrite", (s) => s.put({ id, blob, cuts, saved_at: Date.now() } satisfies StoredRecording));
}

/** A recording by session id, or the newest one when no id is given. */
export async function loadRecording(id?: string): Promise<Recording | null> {
  try {
    const found = id
      ? await run<StoredRecording | undefined>("readonly", (s) => s.get(id))
      : (await run<StoredRecording[]>("readonly", (s) => s.getAll())).sort((a, b) => b.saved_at - a.saved_at)[0];
    return found ? { blob: found.blob, cuts: found.cuts ?? [] } : null;
  } catch (err) {
    console.warn("[recordings] could not load:", err);
    return null;
  }
}

/**
 * Session time (seconds, what events and Work Map moments use) → position in the video.
 * Subtracts every off-the-record span before that moment; a moment inside a span maps to where it began.
 */
export function toVideoSeconds(sessionS: number, cuts: Cut[]): number {
  const ms = sessionS * 1000;
  let removed = 0;
  for (const c of cuts) {
    if (c.from >= ms) break;
    removed += Math.min(c.to, ms) - c.from;
  }
  return Math.max(0, (ms - removed) / 1000);
}

/** Delete every stored recording. Used by the demo reset. */
export async function clearRecordings(): Promise<void> {
  await run("readwrite", (s) => s.clear());
}
