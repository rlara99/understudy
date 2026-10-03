// Owner: Renzo. The Claude-powered routes: frame, map, route, patch.
import { Router } from "express";
import { z } from "zod";
import type { Expert, SessionLog, WorkMap } from "../../src/shared/types";
import { client, MODELS, askJson } from "../claude";
import { readJson, safeId, writeJson } from "../store";

export const aiRoutes = Router();

// ---------- shared zod schemas (mirror src/shared/types.ts) ----------
const Moment = z.object({ t: z.string(), clip_s: z.number() });
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
// Optional path (cut first if behind). The ERP's own events are the main signal.
aiRoutes.post("/frame", async (req, res) => {
  const { image, previous } = req.body as { image: string; previous?: string };
  const response = await client.messages.create({
    model: MODELS.frames,
    max_tokens: 300,
    system:
      "You watch an accounts-payable clerk's screen. Reply with one short line per visible change since the previous description, like 'invoice 4471 opened' or 'cost center changed 4711 -> 0400'. Reply 'no change' if nothing changed. Never transcribe IBANs or personal names.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: `Previous description: ${previous ?? "none"}` },
        ],
      },
    ],
  });
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  res.json({ changes: text.split("\n").map((s) => s.trim()).filter((s) => s && s !== "no change") });
});

// ---------- POST /api/map  { sessionId, workflow, expert, team, confirm?, debriefStartedAt? } ----------
// First call (after the task): draft map + gaps for the debrief.
// Second call with confirm: true (after the teach-back): folds in the debrief answers, marks confirmed.
aiRoutes.post("/map", async (req, res) => {
  const { sessionId, workflow, expert, team, confirm, debriefStartedAt } = req.body as {
    sessionId: string;
    workflow: string;
    expert: string;
    team: string;
    confirm?: boolean;
    /** ms on the session clock when the debrief began; transcript lines after it are debrief answers. */
    debriefStartedAt?: number;
  };
  const id = safeId(sessionId);
  const log = await readJson<SessionLog>(`sessions/${id}.json`);
  const debriefNote = confirm
    ? `
The transcript continues after the task with a spoken debrief (lines with t >= ${debriefStartedAt ?? 0} ms): the expert answered follow-up questions and confirmed or corrected a teach-back. Use those answers to fill in reasons and guardrails, and apply every correction. Return "gaps" only for things still unanswered.`
    : "";
  const result = await askJson({
    schema: z.object({ steps: z.array(Step), guardrails: z.array(Guardrail), gaps: z.array(z.string()) }),
    system: `You turn a recorded work session into a Work Map that a new hire can learn from.
Use the expert's own words for every reason and guardrail quote. Times are mm:ss from the recording start (event t is in ms); a step's moment.clip_s is the seconds into the recording where it happened.
Guardrail text: one plain rule a new hire can follow, under 15 words. Never mention checks, fields, data or the system in it.
Give every guardrail a machine check whenever you can: if every "when" condition holds and "require" does not, the save is blocked. Invoice fields: ${INVOICE_FIELDS}. If the rule depends on something not in these fields (for example "equipment"), approximate it with the fields you have (for example amount gt 5000 and currency eq EUR) instead of leaving the check out.
off_record lists time spans (ms) the expert took off the record. Never use anything from inside them: no steps, reasons, quotes or gaps.
List as "gaps" the questions a new hire would still need answered: missing reasons, unclear limits, exceptions you saw but were not explained. Each gap is ONE short spoken question, under 20 words. Max 5, most important first.${debriefNote}`,
    user: JSON.stringify({ events: log.events, transcript: log.transcript, off_record: log.off_record ?? [] }),
  });
  const map: WorkMap = {
    id,
    workflow,
    expert,
    team,
    confirmed: Boolean(confirm),
    steps: result.steps,
    guardrails: result.guardrails as WorkMap["guardrails"],
    open_questions: [],
    updated_at: new Date().toISOString(),
  };
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json({ map, gaps: result.gaps });
});

// ---------- POST /api/route  { question, context?, open?: {id, q}[] } ----------
// Returns the expert to ask, a short general question, and duplicate_of when an open question already covers it.
aiRoutes.post("/route", async (req, res) => {
  const { question, context, open } = req.body as {
    question: string;
    context?: string;
    open?: { id: string; q: string }[];
  };
  const experts = await readJson<Expert[]>("experts.json");
  const result = await askJson({
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
    user: JSON.stringify({ question, context, open: open ?? [], experts }),
  });
  res.json(result);
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
  map.updated_at = new Date().toISOString();
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json(map);
});
