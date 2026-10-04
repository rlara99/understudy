// Which Work Map the Assistant, the ERP (teach) and new learner questions use. One rule, so they always agree.
import type { WorkMap } from "./types";

/** Most recently confirmed first; maps confirmed before `confirmed_at` existed (and drafts) follow by `updated_at`. */
export const byConfirmed = (a: WorkMap, b: WorkMap) =>
  (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? "") || b.updated_at.localeCompare(a.updated_at);

/** Most recently confirmed real map wins (renames, questions and deletes don't change it); then the newest draft; the hand-made sample is the fallback. */
export function pickMap(maps: WorkMap[]): WorkMap | null {
  const sorted = [...maps].sort(byConfirmed);
  return sorted.find((m) => !m.sample && m.confirmed) ?? sorted.find((m) => !m.sample) ?? sorted[0] ?? null;
}
