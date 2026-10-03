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
