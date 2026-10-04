// Owner: Renzo. Renaming, kept in sync between sessions ("trials") and the Work Maps built from them.
// POST  /api/sessions/rename { ids, name }  → renames every part; maps built only from these sessions get the name too
// PATCH /api/workmaps/:id     { workflow }  → renames the map; its source sessions get the name too (if they shared one)
import { Router } from "express";
import type { SessionLog, WorkMap } from "../../src/shared/types";
import { listJson, readJson, safeId, updateJson, writeJson } from "../store";

export const renameRoutes = Router();

const cleanName = (raw: unknown): string => {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new Error("A name needs 1 to 80 characters");
  return name;
};
const titleFor = (name: string, part?: number) => `${name}${(part ?? 1) > 1 ? ` · part ${part}` : ""}`;

renameRoutes.post("/sessions/rename", async (req, res) => {
  const name = cleanName(req.body?.name);
  const ids = ((req.body?.ids ?? []) as string[]).map(safeId);
  if (ids.length === 0) {
    res.status(400).json({ error: "No sessions given" });
    return;
  }
  const logs = await Promise.all(ids.map((id) => readJson<SessionLog>(`sessions/${id}.json`)));
  await Promise.all(logs.map((l) => writeJson(`sessions/${l.id}.json`, { ...l, name, title: titleFor(name, l.part) })));
  // Work Maps built only from these sessions take the new name (Knowledge Repository shows it).
  const maps = await listJson<WorkMap>("workmaps");
  const renamed: string[] = [];
  for (const m of maps) {
    if (m.sources?.length && m.sources.every((s) => ids.includes(s))) {
      await updateJson<WorkMap>(`workmaps/${m.id}.json`, (cur) => ({ ...cur, workflow: name, updated_at: new Date().toISOString() }));
      renamed.push(m.id);
    }
  }
  res.json({ ok: true, name, maps_renamed: renamed });
});

renameRoutes.patch("/workmaps/:id", async (req, res) => {
  const workflow = cleanName(req.body?.workflow);
  const updated = (await updateJson<WorkMap>(`workmaps/${safeId(req.params.id)}.json`, (cur) => ({
    ...cur,
    workflow,
    updated_at: new Date().toISOString(),
  })))!;
  // Its source sessions follow, if they were one named session (so Debrief & teach matches).
  let sessionsRenamed = 0;
  if (updated.sources?.length) {
    const logs = (await Promise.all(updated.sources.map((id) => readJson<SessionLog>(`sessions/${safeId(id)}.json`).catch(() => null)))).filter(
      (l): l is SessionLog => l !== null,
    );
    const names = new Set(logs.map((l) => l.name ?? ""));
    if (logs.length && names.size === 1) {
      await Promise.all(logs.map((l) => writeJson(`sessions/${l.id}.json`, { ...l, name: workflow, title: titleFor(workflow, l.part) })));
      sessionsRenamed = logs.length;
    }
  }
  res.json({ ...updated, sessions_renamed: sessionsRenamed });
});
