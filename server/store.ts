// Owner: Renzo. JSON files under data/ are the whole database.
import fs from "node:fs/promises";
import path from "node:path";

const DATA = path.resolve("data");

export async function readJson<T>(rel: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DATA, rel), "utf8")) as T;
}

export async function writeJson(rel: string, value: unknown): Promise<void> {
  const file = path.join(DATA, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Read, change and write one file, one change at a time per file, so a slow change (e.g. a Claude call
 * before it) can't undo another one. `change` gets the current contents; return null to write nothing.
 */
export async function updateJson<T>(rel: string, change: (current: T) => T | null | Promise<T | null>): Promise<T | null> {
  const run = (locks.get(rel) ?? Promise.resolve()).then(async () => {
    const next = await change(await readJson<T>(rel));
    if (next) await writeJson(rel, next);
    return next;
  });
  const tail = run.catch(() => {});
  locks.set(rel, tail);
  try {
    return await run;
  } finally {
    if (locks.get(rel) === tail) locks.delete(rel);
  }
}

export async function listJson<T>(dir: string): Promise<T[]> {
  const full = path.join(DATA, dir);
  await fs.mkdir(full, { recursive: true });
  const names = (await fs.readdir(full)).filter((n) => n.endsWith(".json"));
  return Promise.all(names.map((n) => readJson<T>(path.join(dir, n))));
}

/** Only allow simple ids in file names. */
export function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

/** Delete a JSON file under data/. Missing files are fine. */
export async function deleteJson(rel: string): Promise<void> {
  await fs.rm(path.join(DATA, rel), { force: true });
}
