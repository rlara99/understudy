// Owner: Renzo. Plain read/write routes so Pablo's screens can load and save data.
import { Router } from "express";
import type { Expert, Invoice, SessionLog, WorkMap } from "../../src/shared/types";
import { listJson, readJson, safeId, writeJson } from "../store";

export const dataRoutes = Router();

dataRoutes.get("/invoices", async (_req, res) => {
  res.json(await readJson<Invoice[]>("invoices.json"));
});

dataRoutes.get("/experts", async (_req, res) => {
  res.json(await readJson<Expert[]>("experts.json"));
});

dataRoutes.get("/workmaps", async (_req, res) => {
  res.json(await listJson<WorkMap>("workmaps"));
});

dataRoutes.get("/workmaps/:id", async (req, res) => {
  res.json(await readJson<WorkMap>(`workmaps/${safeId(req.params.id)}.json`));
});

dataRoutes.put("/workmaps/:id", async (req, res) => {
  const map = { ...(req.body as WorkMap), id: safeId(req.params.id), updated_at: new Date().toISOString() };
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json(map);
});

// Session list for "Debrief and teach": newest first, without the heavy event/transcript arrays.
dataRoutes.get("/sessions", async (_req, res) => {
  const logs = await listJson<SessionLog>("sessions");
  res.json(
    logs
      .map(({ events, transcript, ...rest }) => ({ ...rest, event_count: events.length, transcript_count: transcript.length }))
      .sort((a, b) => b.started_at.localeCompare(a.started_at)),
  );
});

dataRoutes.get("/sessions/:id", async (req, res) => {
  res.json(await readJson<SessionLog>(`sessions/${safeId(req.params.id)}.json`));
});

dataRoutes.put("/sessions/:id", async (req, res) => {
  const log = { ...(req.body as SessionLog), id: safeId(req.params.id) };
  await writeJson(`sessions/${log.id}.json`, log);
  res.json({ ok: true });
});
