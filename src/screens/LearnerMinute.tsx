// Owner: Pablo. Learner › Expert Minute: ask the experts something no task covers yet,
// and follow your questions until an expert answers. Route: #/learner/minute.
//
// Submitting uses POST /api/questions when the server has it (Renzo). Until then it does
// what the tutor's flag_open_question does: /api/route (picks the expert, merges duplicates)
// and then saves the question into the task's Work Map.
import { useEffect, useState } from "react";
import { getJson, postJson, putJson } from "../shared/api";
import type { OpenQuestion, WorkMap } from "../shared/types";
import "./screens.css";

const MINE_KEY = "understudy.myQuestions";

interface Mine {
  workmapId: string;
  questionId: string;
  asked_at: number;
}

type Answered = OpenQuestion & { answer_clean?: string };

function readMine(): Mine[] {
  try {
    return JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function addMine(m: Mine) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify([m, ...readMine().filter((x) => x.questionId !== m.questionId)]));
  } catch {
    /* storage blocked: the question is still saved on the server */
  }
}

/** Newest confirmed real map wins; the sample is the fallback (same rule as the ERP and tutor). */
function pickMap(maps: WorkMap[]): WorkMap | null {
  const byDate = [...maps].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return byDate.find((m) => !m.sample && m.confirmed) ?? byDate.find((m) => !m.sample) ?? byDate[0] ?? null;
}

async function submitQuestion(question: string, context: string | undefined, workmapId: string): Promise<Mine> {
  // Preferred: the server route, once it exists.
  try {
    const res = await postJson<{ workmapId: string; question: OpenQuestion }>("/api/questions", { question, context, workmapId });
    return { workmapId: res.workmapId, questionId: res.question.id, asked_at: Date.now() };
  } catch (err) {
    if (!/\b404\b/.test(String(err))) throw err;
  }
  // Fallback: route it and save it into the map ourselves.
  const map = await getJson<WorkMap>(`/api/workmaps/${workmapId}`);
  const open = map.open_questions.filter((q) => q.status === "open");
  const routed = await postJson<{ expert_name: string; reason: string; neutral_question: string; duplicate_of: string | null }>(
    "/api/route",
    { question, context, open: open.map((q) => ({ id: q.id, q: q.q })) },
  );
  let id: string;
  const same = open.find((q) => q.id === routed.duplicate_of);
  if (same) {
    same.asked_by_count += 1;
    id = same.id;
  } else {
    id = `q-${Date.now()}`;
    map.open_questions.push({
      id,
      q: routed.neutral_question,
      context,
      asked_by_count: 1,
      route_to: routed.expert_name,
      route_reason: routed.reason,
      status: "open",
    });
  }
  await putJson(`/api/workmaps/${map.id}`, map);
  return { workmapId: map.id, questionId: id, asked_at: Date.now() };
}

export function LearnerMinute() {
  const [maps, setMaps] = useState<WorkMap[]>([]);
  const [mine, setMine] = useState<Mine[]>(readMine);
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    const load = () => getJson<WorkMap[]>("/api/workmaps").then(setMaps).catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const defaultTask = pickMap(maps)?.id ?? "";
  const find = (m: Mine) => {
    const map = maps.find((x) => x.id === m.workmapId);
    const q = map?.open_questions.find((x) => x.id === m.questionId) as Answered | undefined;
    return map && q ? { map, q } : null;
  };
  const myItems = mine.map((m) => ({ m, found: find(m) })).filter((x) => x.found);
  const othersAnswered = maps
    .flatMap((map) => map.open_questions.filter((q) => q.status === "answered").map((q) => ({ map, q: q as Answered })))
    .filter(({ q }) => !mine.some((m) => m.questionId === q.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = task || defaultTask;
    if (!question.trim() || !target) return;
    setBusy(true);
    setError(null);
    setSentTo(null);
    try {
      const m = await submitQuestion(question.trim(), context.trim() || undefined, target);
      addMine(m);
      setMine(readMine());
      const updated = await getJson<WorkMap[]>("/api/workmaps");
      setMaps(updated);
      const q = updated.find((x) => x.id === m.workmapId)?.open_questions.find((x) => x.id === m.questionId);
      setSentTo(q?.route_to ?? "the experts");
      setQuestion("");
      setContext("");
    } catch (err) {
      setError(`Could not send your question: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen lm">
      <header className="wm-head">
        <div>
          <h2>Expert Minute</h2>
          <p>Ask what no task covers yet. It goes to the expert who knows best, without your name on it.</p>
        </div>
      </header>

      <form className="card lm-form" onSubmit={submit}>
        <label>
          Your question
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What do I do with an invoice in Swiss francs?"
            disabled={busy}
            required
          />
        </label>
        <div className="lm-row">
          <label>
            About which task?
            <select value={task || defaultTask} onChange={(e) => setTask(e.target.value)} disabled={busy}>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.workflow}
                  {m.sample ? " (sample)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Where did you see it? <span className="muted">(optional)</span>
            <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="e.g. INV-5103" disabled={busy} />
          </label>
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || !question.trim() || maps.length === 0}>
            {busy ? "Finding the right expert…" : "Ask the experts"}
          </button>
          {sentTo && <span className="lm-sent">Sent to {sentTo} · the answer will show up below</span>}
          {error && <span className="err small">{error}</span>}
        </div>
      </form>

      <section>
        <h3 className="eyebrow">My questions</h3>
        {myItems.length === 0 ? (
          <p className="muted small">Questions you ask here, and their answers, show up in this list.</p>
        ) : (
          <ul className="lm-list">
            {myItems.map(({ m, found }) => {
              const { map, q } = found!;
              const answered = q.status === "answered";
              return (
                <li key={m.questionId} className={`lm-item ${answered ? "done" : "waiting"}`}>
                  <span className="lib-pills">
                    <span className={`pill ${answered ? "ok" : "gap"}`}>{answered ? "Answered" : "Waiting"}</span>
                    {q.asked_by_count > 1 && <span className="pill line">Also asked by {q.asked_by_count - 1} more</span>}
                  </span>
                  <b>{q.q}</b>
                  {answered ? (
                    <>
                      <q>{q.answer_clean ?? q.answer}</q>
                      <span className="muted small">
                        {q.route_to} · now part of{" "}
                        <a href={`#/learner/knowledge/${map.id}`}>{map.workflow}</a>
                      </span>
                    </>
                  ) : (
                    <span className="muted small">
                      With {q.route_to ?? "the experts"}
                      {q.route_reason ? `: ${q.route_reason}` : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {othersAnswered.length > 0 && (
        <section>
          <h3 className="eyebrow">Recently answered for the team</h3>
          <ul className="lm-list">
            {othersAnswered.map(({ map, q }) => (
              <li key={`${map.id}.${q.id}`} className="lm-item done">
                <b>{q.q}</b>
                <q>{q.answer_clean ?? q.answer}</q>
                <span className="muted small">
                  {q.route_to} · <a href={`#/learner/knowledge/${map.id}`}>{map.workflow}</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
