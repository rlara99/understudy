// SHARED FILE: rename sessions and Work Maps. Names stay in sync both ways (see server/routes/renames.ts).
import type { WorkMap } from "./types";

async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Rename a session ("trial") and all its parts. Work Maps built only from them are renamed too. */
export function renameSessions(ids: string[], name: string) {
  return send<{ ok: true; name: string; maps_renamed: string[] }>("POST", "/api/sessions/rename", { ids, name });
}

/** Rename a Work Map (task / training). Its source sessions follow. Returns the updated map. */
export function renameWorkMap(id: string, name: string) {
  return send<WorkMap & { sessions_renamed: number }>("PATCH", `/api/workmaps/${id}`, { workflow: name });
}
