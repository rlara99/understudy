// Owner: Renzo. The Claude-powered routes: frame, map, route, questions, patch.
import { Router } from "express";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Expert, OpenQuestion, SessionLog, TranscriptLine, WorkMap } from "../../src/shared/types";
import { client, MODELS, askJson } from "../claude";
import { listJson, readJson, safeId, writeJson } from "../store";

export const aiRoutes = Router();

// ---------- shared zod schemas (mirror src/shared/types.ts) ----------
const Moment = z.object({ t: z.string(), clip_s: z.number(), session: z.string().optional() });
const Condition = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "gt", "lt", "contains", "present"]),
  value: z.union([z.string(), z.number()]).optional(),
});
const Guardrail = z.object({
  id: z.string(),
  text: z.string(),
  quote: z.string().optional(),
  said_at: z.string().optional(),
  check: z.object({ when: z.array(Condition), require: Condition }).optional(),
});
const Step = z.object({
  id: z.string(),
  title: z.string(),
  moment: Moment,
  decision: z.string(),
  reason: z.string(),
  said_at: z.string(),
  guardrails: z.array(z.string()),
});
const INVOICE_FIELDS =
  "id, supplier, supplier_known (true|false), country (ISO code), date (YYYY-MM-DD), description, amount, currency (EUR|USD), cost_center, asset_no, approval (single|second), status (open|held|posted|pending_approval)";

// ---------- POST /api/frame  { image: base64 jpeg, previous?: string } ----------
// Vision for ANY app: what changed, whether a task was just finished, and whether a judgment call happened.
const FrameResult = z.object({
  app: z.string(),
  changes: z.array(z.string()),
  task_done: z.string().nullable(),
  judgment_call: z.string().nullable(),
});
aiRoutes.post("/frame", async (req, res) => {
  const { image, previous } = req.body as { image: string; previous?: string };
  const response = await client.messages.parse({
    model: MODELS.frames,
    max_tokens: 600,
    output_config: { format: zodOutputFormat(FrameResult) },
    system: `You watch a knowledge worker's screen (any app: ERP, Excel, email, browser) so an apprentice can learn their job.
Compare with the previous description and report:
- app: the app in front, e.g. "Excel", "Outlook", "SAP", "Chrome".
- changes: one short line per meaningful change since the previous description ("invoice 4471 opened", "cost center changed 4711 -> 0400", "email to controller drafted"). Empty if nothing meaningful changed. Ignore cursor moves and scrolling.
- task_done: if the worker just finished a unit of work (saved, sent, submitted, posted, closed a case), a one-line summary of it; else null.
- judgment_call: if a change looks like a decision an expert would make for a reason the screen doesn't show (a recode, a hold, an escalation, an exception, an override), one line naming it; else null.
Ignore the Understudy / Claudia assistant window itself (a small panel with a transcript and \"Off the record\"/\"Finish\" buttons): it is not the work.
Never transcribe IBANs, account numbers, personal names, emails or phone numbers.`,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: `Previous description: ${previous ?? "none (first frame)"}` },
        ],
      },
    ],
  });
  if (!response.parsed_output) {
    res.status(502).json({ error: `No frame description (stop_reason: ${response.stop_reason})` });
    return;
  }
  res.json(response.parsed_output);
});

// ---------- POST /api/transcribe?speaker=expert|other&offset=ms  (raw audio body) ----------
// Record and learn: ElevenLabs Scribe v2 speech-to-text. Mic and call audio are sent separately,
// so the expert's own words are always "expert" and call participants are "other".
aiRoutes.post("/transcribe", async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(503).json({ error: "ELEVENLABS_API_KEY is not set in .env" });
    return;
  }
  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    res.status(400).json({ error: "No audio received" });
    return;
  }
  const speaker = req.query.speaker === "other" ? "other" : "expert";
  const offset = Number(req.query.offset ?? 0) || 0;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: req.headers["content-type"] || "audio/webm" }), "audio.webm");
  form.append("model_id", process.env.STT_MODEL ?? "scribe_v2");
  form.append("diarize", speaker === "other" ? "true" : "false");
  form.append("tag_audio_events", "false");
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!r.ok) {
    res.status(502).json({ error: `Transcription failed: ${r.status} ${(await r.text()).slice(0, 200)}` });
    return;
  }
  const data = (await r.json()) as {
    text?: string;
    words?: { text: string; start?: number; type?: string; speaker_id?: string }[];
  };
  // Group words into lines: a new line when the speaker changes or after a 1.5 s gap.
  const lines: TranscriptLine[] = [];
  let lastEnd = -1;
  for (const w of data.words ?? []) {
    if (w.type && w.type !== "word") {
      if (lines.length && w.type === "spacing") lines[lines.length - 1].text += w.text;
      continue;
    }
    const start = w.start ?? 0;
    const label = w.speaker_id ?? speaker;
    const prev = lines[lines.length - 1];
    if (prev && prev.speaker_label === label && start - lastEnd < 1.5) prev.text += w.text;
    else lines.push({ t: Math.round(offset + start * 1000), speaker, speaker_label: label, text: w.text });
    lastEnd = start;
  }
  lines.forEach((l) => (l.text = l.text.trim()));
  res.json({ lines: lines.filter((l) => l.text), text: data.text ?? "" });
});

// ---------- POST /api/map ----------
// { sessionIds | sessionId, workflow?, expert, team, mapId?, confirm?, debrief? }
// First call: draft map + gaps from one or more sessions (the day's work).
// Second call with confirm: true, the same mapId and the debrief transcript: folds the answers in, marks confirmed.
aiRoutes.post("/map", async (req, res) => {
  const body = req.body as {
    sessionIds?: string[];
    sessionId?: string;
    workflow?: string;
    expert: string;
    team: string;
    mapId?: string;
    confirm?: boolean;
    /** Debrief conversation (module "Debrief and teach"). */
    debrief?: TranscriptLine[];
    /** Legacy single-session debrief: transcript lines after this ms are debrief answers. */
    debriefStartedAt?: number;
  };
  const ids = (body.sessionIds ?? (body.sessionId ? [body.sessionId] : [])).map(safeId);
  if (ids.length === 0) {
    res.status(400).json({ error: "No sessions given" });
    return;
  }
  const logs = await Promise.all(ids.map((id) => readJson<SessionLog>(`sessions/${id}.json`)));
  const id = safeId(body.mapId ?? (ids.length === 1 ? ids[0] : `map-${Date.now()}`));
  const debriefNote = body.confirm
    ? body.debrief
      ? `
"debrief" is a spoken debrief held afterwards: the expert answered follow-up questions and confirmed or corrected a teach-back. Use those answers to fill in reasons and guardrails, and apply every correction. Return "gaps" only for things still unanswered.`
      : `
The transcript continues after the task with a spoken debrief (lines with t >= ${body.debriefStartedAt ?? 0} ms): the expert answered follow-up questions and confirmed or corrected a teach-back. Use those answers to fill in reasons and guardrails, and apply every correction. Return "gaps" only for things still unanswered.`
    : "";
  const result = await askJson({
    schema: z.object({
      workflow_title: z.string(),
      steps: z.array(Step),
      guardrails: z.array(Guardrail),
      gaps: z.array(z.string()),
    }),
    system: `You turn recorded work sessions into a Work Map that a new hire can learn from.
Sessions come from "live" work (the apprentice asked questions) or "record" work (silent recording; the transcript may include a call, where speaker "other" is someone else on the call). Screen events of type "screen" were seen by vision in any app; other events come from the ERP.
Use the expert's own words for every reason and guardrail quote. Times are mm:ss from that session's recording start (event t is in ms); a step's moment.clip_s is the seconds into that recording, and moment.session is the id of the session it happened in.
workflow_title: a short name for the work, e.g. "Supplier invoice processing".
Guardrail text: one plain rule a new hire can follow, under 15 words. Never mention checks, fields, data or the system in it.
Give every guardrail a machine check whenever you can: if every "when" condition holds and "require" does not, the save is blocked. Invoice fields: ${INVOICE_FIELDS}. If the rule depends on something not in these fields (for example "equipment"), approximate it with the fields you have (for example amount gt 5000 and currency eq EUR) instead of leaving the check out. Rules about other apps get no check.
off_record lists time spans (ms) the expert took off the record. Never use anything from inside them: no steps, reasons, quotes or gaps.
List as "gaps" the questions a new hire would still need answered: missing reasons, unclear limits, exceptions you saw but were not explained. Each gap is ONE short spoken question, under 20 words. Max 5, most important first.${debriefNote}`,
    user: JSON.stringify({
      sessions: logs.map((l) => ({
        id: l.id,
        mode: l.mode,
        title: l.title,
        events: l.events,
        transcript: l.transcript,
        off_record: l.off_record ?? [],
      })),
      ...(body.debrief ? { debrief: body.debrief } : {}),
    }),
  });
  // Keep open questions if this map already existed (e.g. confirming a draft).
  let previous: WorkMap | null = null;
  try {
    previous = await readJson<WorkMap>(`workmaps/${id}.json`);
  } catch {
    previous = null;
  }
  const map: WorkMap = {
    id,
    workflow: body.workflow ?? result.workflow_title,
    expert: body.expert,
    team: body.team,
    confirmed: Boolean(body.confirm),
    steps: result.steps.map((s) => ({ ...s, moment: { ...s.moment, session: s.moment.session ?? ids[0] } })),
    guardrails: result.guardrails as WorkMap["guardrails"],
    open_questions: previous?.open_questions ?? [],
    updated_at: new Date().toISOString(),
    sources: ids,
  };
  await writeJson(`workmaps/${map.id}.json`, map);
  if (body.confirm) {
    await Promise.all(logs.map((l) => writeJson(`sessions/${l.id}.json`, { ...l, reviewed_in: map.id })));
  }
  res.json({ map, gaps: result.gaps });
});

// ---------- routing: expert + short general question + duplicate detection ----------
async function routeQuestion(question: string, context: string | undefined, open: { id: string; q: string }[]) {
  const experts = await readJson<Expert[]>("experts.json");
  return askJson({
    schema: z.object({
      expert_name: z.string(),
      reason: z.string(),
      neutral_question: z.string(),
      duplicate_of: z.string().nullable(),
    }),
    system: `A new hire hit a case their training doesn't cover.
1. Pick the one expert (by exact name) best placed to answer, based on title, team and topics. Give the reason in one sentence.
2. Write neutral_question: a short, general question an expert can answer in a minute, under 20 words. Ask about the kind of case, not this one invoice: no invoice numbers, dates or amounts. No names, nothing that reveals who asked. Example: "How do we book invoices in a foreign currency, and is there a limit?"
3. duplicate_of: if one of the open questions already asks essentially the same thing, its id; otherwise null.`,
    user: JSON.stringify({ question, context, open, experts }),
  });
}

// ---------- POST /api/route  { question, context?, open?: {id, q}[] } ----------
aiRoutes.post("/route", async (req, res) => {
  const { question, context, open } = req.body as {
    question: string;
    context?: string;
    open?: { id: string; q: string }[];
  };
  res.json(await routeQuestion(question, context, open ?? []));
});

/** Map that new questions go to: the given one, else the newest confirmed real map, else the newest map. */
async function targetMap(mapId?: string): Promise<WorkMap | null> {
  if (mapId) return readJson<WorkMap>(`workmaps/${safeId(mapId)}.json`);
  const maps = (await listJson<WorkMap>("workmaps")).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return maps.find((m) => !m.sample && m.confirmed) ?? maps.find((m) => !m.sample) ?? maps[0] ?? null;
}

// ---------- POST /api/questions  { question, context?, asker?, mapId? } ----------
// A learner's question (typed in Expert Minute, or flagged by the Assistant). Routed, merged with duplicates.
aiRoutes.post("/questions", async (req, res) => {
  const { question, context, asker, mapId } = req.body as {
    question: string;
    context?: string;
    asker?: string;
    mapId?: string;
  };
  if (!question?.trim()) {
    res.status(400).json({ error: "Empty question" });
    return;
  }
  const map = await targetMap(mapId);
  if (!map) {
    res.status(409).json({ error: "No Work Map yet to attach questions to" });
    return;
  }
  const open = map.open_questions.filter((q) => q.status === "open");
  const routed = await routeQuestion(question, context, open.map((q) => ({ id: q.id, q: q.q })));
  let q = open.find((x) => x.id === routed.duplicate_of);
  const merged = Boolean(q);
  if (q) {
    q.asked_by_count += 1;
    if (asker && !q.askers?.includes(asker)) q.askers = [...(q.askers ?? []), asker];
  } else {
    q = {
      id: `q-${Date.now()}`,
      q: routed.neutral_question,
      context,
      asked_by_count: 1,
      route_to: routed.expert_name,
      route_reason: routed.reason,
      status: "open",
      askers: asker ? [asker] : [],
      asked_at: new Date().toISOString(),
    } satisfies OpenQuestion;
    map.open_questions.push(q);
  }
  map.updated_at = new Date().toISOString();
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json({ question: q, map_id: map.id, workflow: map.workflow, merged });
});

// ---------- GET /api/questions?asker=Name ----------
// Every question across Work Maps (only the asker's own when asker is given), newest first.
aiRoutes.get("/questions", async (req, res) => {
  const asker = typeof req.query.asker === "string" ? req.query.asker : undefined;
  const maps = await listJson<WorkMap>("workmaps");
  const all = maps.flatMap((m) =>
    m.open_questions
      .filter((q) => !asker || q.askers?.includes(asker))
      .map((q) => ({ ...q, map_id: m.id, workflow: m.workflow })),
  );
  all.sort((a, b) => (b.asked_at ?? "").localeCompare(a.asked_at ?? ""));
  res.json(all);
});

// ---------- POST /api/patch  { workmapId, questionId, answer, expert } ----------
aiRoutes.post("/patch", async (req, res) => {
  const { workmapId, questionId, answer, expert } = req.body as {
    workmapId: string;
    questionId: string;
    answer: string;
    expert: string;
  };
  const map = await readJson<WorkMap>(`workmaps/${safeId(workmapId)}.json`);
  const question = map.open_questions.find((q) => q.id === questionId);
  if (!question) {
    res.status(404).json({ error: `Question ${questionId} not found` });
    return;
  }
  const result = await askJson({
    schema: z.object({ answer_clean: z.string(), step: Step, guardrails: z.array(Guardrail) }),
    system: `An expert answered an open question about a workflow by voice. The answer may be a speech-to-text transcript with mistakes and filler, and may include the agent's repeat-back that the expert confirmed; trust the confirmed repeat-back where the transcript is garbled.
answer_clean: the expert's answer in one or two clear sentences, in their voice ("Convert at ...").
Then turn it into one new Work Map step and any guardrails it implies, using the expert's words. Use moment {t:"00:00", clip_s:0} and said_at "quick ask". New ids must not clash with existing ones. Guardrail text: one plain rule under 15 words, written for a new hire. Never mention checks, fields, data or the system in it. Add a machine check when possible. Invoice fields for checks: ${INVOICE_FIELDS}.`,
    user: JSON.stringify({ question: question.q, context: question.context, answer, expert, existing: map }),
  });
  map.steps.push(result.step);
  map.guardrails.push(...(result.guardrails as WorkMap["guardrails"]));
  question.status = "answered";
  question.answer = result.answer_clean;
  question.answered_at = new Date().toISOString();
  map.updated_at = new Date().toISOString();
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json(map);
});
