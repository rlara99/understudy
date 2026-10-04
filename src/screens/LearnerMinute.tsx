// Owner: Pablo. Learner › Expert Minute: ask the experts something no task covers yet,
// and follow your questions until an expert answers. Route: #/learner/minute.
// Server (Renzo): POST /api/questions routes the question, merges duplicates and records the
// asker; GET /api/questions?asker=<name> lists that learner's questions. Experts never see names.
import { useEffect, useState } from "react";
import { LEARNER } from "../panel/TutorPanel";
import { getJson, postJson, putJson } from "../shared/api";
import { ConfirmDelete } from "../shared/ConfirmDelete";
import { deleteQuestion } from "../shared/deletes";
import type { OpenQuestion, WorkMap } from "../shared/types";
import "./screens.css";

type Listed = OpenQuestion & { map_id: string; workflow: string };

/** Withdraw my question: delete it if I'm the only one who asked, otherwise just take my vote off. */
async function withdraw(q: Listed) {
  // Counts from before repeat asks stopped adding votes can be over 1 with only me asking: nobody else would own it.
  if (q.asked_by_count <= 1 || (q.askers ?? []).every((a) => a === LEARNER)) {
    await deleteQuestion(q.map_id, q.id);
    return;
  }
  const map = await getJson<WorkMap>(`/api/workmaps/${q.map_id}`);
  const target = map.open_questions.find((x) => x.id === q.id);
  if (!target) return;
  target.asked_by_count = Math.max(1, target.asked_by_count - 1);
  target.askers = (target.askers ?? []).filter((a) => a !== LEARNER);
  await putJson(`/api/workmaps/${map.id}`, map);
}

interface Posted {
  question: OpenQuestion;
  map_id: string;
  workflow: string;
  merged: boolean;
  /** This learner had already asked it: no new vote. */
  already_asked?: boolean;
}

export function LearnerMinute() {
  const [maps, setMaps] = useState<WorkMap[]>([]);
  const [mine, setMine] = useState<Listed[] | null>(null);
  const [all, setAll] = useState<Listed[]>([]);
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Posted | null>(null);

  const load = () => {
    getJson<Listed[]>(`/api/questions?asker=${encodeURIComponent(LEARNER)}`).then(setMine).catch(() => setMine((m) => m ?? []));
    getJson<Listed[]>("/api/questions").then(setAll).catch(() => {});
  };
  useEffect(() => {
    load();
    getJson<WorkMap[]>("/api/workmaps").then(setMaps).catch(() => {});
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const othersAnswered = all.filter((q) => q.status === "answered" && !q.askers?.includes(LEARNER));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await postJson<Posted>("/api/questions", {
        question: question.trim(),
        context: context.trim() || undefined,
        asker: LEARNER,
        mapId: task || undefined,
      });
      setSent(res);
      setQuestion("");
      setContext("");
      load();
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
            <select value={task} onChange={(e) => setTask(e.target.value)} disabled={busy}>
              <option value="">Let Understudy decide</option>
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
          <button type="submit" className="primary" disabled={busy || !question.trim()}>
            {busy ? "Finding the right expert…" : "Ask the experts"}
          </button>
          {sent && (
            <span className="lm-sent">
              {sent.already_asked
                ? `You already asked this. It's still with ${sent.question.route_to ?? "the experts"}`
                : sent.merged
                  ? `Someone already asked this. Added your vote; it's with ${sent.question.route_to ?? "the experts"}`
                  : `Sent to ${sent.question.route_to ?? "the experts"} · the answer will show up below`}
            </span>
          )}
          {error && <span className="err small">{error}</span>}
        </div>
      </form>

      <section>
        <h3 className="eyebrow">My questions</h3>
        {mine === null ? (
          <p className="muted small">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="muted small">Questions you ask here or through the Assistant, and their answers, show up in this list.</p>
        ) : (
          <ul className="lm-list">
            {mine.map((q) => {
              const answered = q.status === "answered";
              return (
                <li key={`${q.map_id}.${q.id}`} className={`lm-item ${answered ? "done" : "waiting"}`}>
                  <span className="lib-pills">
                    <span className={`pill ${answered ? "ok" : "gap"}`}>{answered ? "Answered" : "Waiting"}</span>
                    {q.asked_by_count > 1 && <span className="pill line">Also asked by {q.asked_by_count - 1} more</span>}
                  </span>
                  <b>{q.q}</b>
                  {answered ? (
                    <>
                      <q>{q.answer}</q>
                      <span className="muted small">
                        {q.route_to} · now part of <a href={`#/learner/knowledge/${q.map_id}`}>{q.workflow}</a>
                      </span>
                    </>
                  ) : (
                    <span className="inbox-done-foot">
                      <span className="muted small">
                        With {q.route_to ?? "the experts"}
                        {q.route_reason ? `: ${q.route_reason}` : ""}
                      </span>
                      <ConfirmDelete
                        label="Withdraw"
                        what={q.asked_by_count > 1 ? "your vote on this question (others asked it too)" : "this question"}
                        onConfirm={async () => {
                          await withdraw(q);
                          load();
                        }}
                      />
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
            {othersAnswered.map((q) => (
              <li key={`${q.map_id}.${q.id}`} className="lm-item done">
                <b>{q.q}</b>
                <q>{q.answer}</q>
                <span className="muted small">
                  {q.route_to} · <a href={`#/learner/knowledge/${q.map_id}`}>{q.workflow}</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
