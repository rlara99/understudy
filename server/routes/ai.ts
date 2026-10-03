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
  "id, supplier, supplier_country, category (equipment|services|logistics|tools), description, amount, currency, date (YYYY-MM-DD), cost_center, asset_no, approval (none|second), status (open|held|posted)";

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

// ---------- POST /api/map  { sessionId, workflow, expert, team } ----------
aiRoutes.post("/map", async (req, res) => {
  const { sessionId, workflow, expert, team } = req.body as {
    sessionId: string;
    workflow: string;
    expert: string;
    team: string;
  };
  const log = await readJson<SessionLog>(`sessions/${safeId(sessionId)}.json`);
  const result = await askJson({
    schema: z.object({ steps: z.array(Step), guardrails: z.array(Guardrail), gaps: z.array(z.string()) }),
    system: `You turn a recorded work session into a Work Map that a new hire can learn from.
Use the expert's own words for every reason and guardrail quote. Times are mm:ss from the recording start (event t is in ms).
For each guardrail that can be checked on an invoice, add a machine check: if every "when" condition holds and "require" does not, the save is blocked. Invoice fields: ${INVOICE_FIELDS}.
List as "gaps" the questions a new hire would still need answered: missing reasons, unclear limits, exceptions you saw but were not explained. Max 5, most important first.`,
    user: JSON.stringify({ events: log.events, transcript: log.transcript, off_record: log.off_record ?? [] }),
  });
  const map: WorkMap = {
    id: safeId(sessionId),
    workflow,
    expert,
    team,
    confirmed: false,
    steps: result.steps,
    guardrails: result.guardrails as WorkMap["guardrails"],
    open_questions: [],
    updated_at: new Date().toISOString(),
  };
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json({ map, gaps: result.gaps });
});

// ---------- POST /api/route  { question, context? } ----------
aiRoutes.post("/route", async (req, res) => {
  const { question, context } = req.body as { question: string; context?: string };
  const experts = await readJson<Expert[]>("experts.json");
  const result = await askJson({
    schema: z.object({ expert_id: z.string(), reason: z.string(), neutral_question: z.string() }),
    system:
      "Pick the one expert best placed to answer a new hire's question, based on title, team and topics. Rewrite the question neutrally: no names, nothing that reveals who asked. Give the reason in one sentence.",
    user: JSON.stringify({ question, context, experts }),
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
    schema: z.object({ step: Step, guardrails: z.array(Guardrail) }),
    system: `An expert answered an open question about a workflow. Turn the answer into one new Work Map step and any guardrails it implies, using the expert's own words. Use moment {t:"00:00", clip_s:0} and said_at "quick ask". New ids must not clash with existing ones. Invoice fields for checks: ${INVOICE_FIELDS}.`,
    user: JSON.stringify({ question: question.q, context: question.context, answer, expert, existing: map }),
  });
  map.steps.push(result.step);
  map.guardrails.push(...(result.guardrails as WorkMap["guardrails"]));
  question.status = "answered";
  question.answer = answer;
  map.updated_at = new Date().toISOString();
  await writeJson(`workmaps/${map.id}.json`, map);
  res.json(map);
});
