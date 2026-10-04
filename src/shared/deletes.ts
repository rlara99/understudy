// SHARED FILE: delete anything in the app. Use with <ConfirmDelete> so nothing goes by accident.
import { deleteRecording } from "../capture/recordings";
import type { WorkMap } from "./types";

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${url} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** A recorded work session (live or record & learn) and its screen recording. */
export async function deleteSession(id: string): Promise<void> {
  await del(`/api/sessions/${id}`);
  await deleteRecording(id).catch(() => {});
}

/** A whole Work Map (task in the Knowledge Repository). Its sessions become available to debrief again. */
export async function deleteWorkMap(id: string): Promise<void> {
  await del(`/api/workmaps/${id}`);
}

/** One step of a Work Map. Guardrails only that step used are removed too. Returns the updated map. */
export function deleteStep(mapId: string, stepId: string): Promise<WorkMap> {
  return del<WorkMap>(`/api/workmaps/${mapId}/steps/${stepId}`);
}

/** One question (open or answered). Returns the updated map. */
export function deleteQuestion(mapId: string, questionId: string): Promise<WorkMap> {
  return del<WorkMap>(`/api/workmaps/${mapId}/questions/${questionId}`);
}
