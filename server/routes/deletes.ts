// Owner: Renzo. Everything the expert or learner can delete.
// DELETE /api/sessions/:id                      a recorded work session (its screen recording lives in the browser: see src/shared/deletes.ts)
// DELETE /api/workmaps/:id                      a whole Work Map (task)
// DELETE /api/workmaps/:id/steps/:stepId        one step; guardrails no other step uses go with it
// DELETE /api/workmaps/:id/questions/:qid       one question (open or answered)
import { Router } from "express";
import type { SessionLog, WorkMap } from "../../src/shared/types";
import { deleteJson, listJson, safeId, updateJson, writeJson } from "../store";

export const deleteRoutes = Router();

deleteRoutes.delete("/sessions/:id", async (req, res) => {
  const id = safeId(req.params.id);
  await deleteJson(`sessions/${id}.json`);
  res.json({ ok: true, deleted: id });
});

deleteRoutes.delete("/workmaps/:id", async (req, res) => {
  const id = safeId(req.params.id);
  await deleteJson(`workmaps/${id}.json`);
  // Sessions that were debriefed into this map can be debriefed again.
  const sessions = await listJson<SessionLog>("sessions");
  await Promise.all(
    sessions
      .filter((s) => s.reviewed_in === id)
      .map(({ reviewed_in: _, ...rest }) => writeJson(`sessions/${rest.id}.json`, rest)),
  );
  res.json({ ok: true, deleted: id });
});

deleteRoutes.delete("/workmaps/:id/steps/:stepId", async (req, res) => {
  const map = await updateJson<WorkMap>(`workmaps/${safeId(req.params.id)}.json`, (map) => {
    const step = map.steps.find((s) => s.id === req.params.stepId);
    if (!step) return null;
    map.steps = map.steps.filter((s) => s.id !== step.id);
    const stillUsed = new Set(map.steps.flatMap((s) => s.guardrails));
    map.guardrails = map.guardrails.filter((g) => !step.guardrails.includes(g.id) || stillUsed.has(g.id));
    map.updated_at = new Date().toISOString();
    return map;
  });
  if (!map) {
    res.status(404).json({ error: `Step ${req.params.stepId} not found` });
    return;
  }
  res.json(map);
});

deleteRoutes.delete("/workmaps/:id/questions/:qid", async (req, res) => {
  const map = await updateJson<WorkMap>(`workmaps/${safeId(req.params.id)}.json`, (map) => {
    const before = map.open_questions.length;
    map.open_questions = map.open_questions.filter((q) => q.id !== req.params.qid);
    if (map.open_questions.length === before) return null;
    map.updated_at = new Date().toISOString();
    return map;
  });
  if (!map) {
    res.status(404).json({ error: `Question ${req.params.qid} not found` });
    return;
  }
  res.json(map);
});
