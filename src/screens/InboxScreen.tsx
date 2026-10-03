// Owner: Pablo. Expert › Expert Minute: open questions routed to experts, no names of who asked.
// "Start voice session" hands the question to the panel (quick_ask mode) via openSession:
// a companion window on desktop, the same tab in a browser.
// "Answer in text" is the fallback from the cut list: it patches the Work Map directly.
import { useEffect, useState } from "react";
import { getJson, postJson } from "../shared/api";
import { openSession, SESSION_ROUTES } from "../shared/desktop";
import type { Expert, OpenQuestion, WorkMap } from "../shared/types";
import { setPendingQuickAsk } from "./quickAsk";
import "./screens.css";

type Item = OpenQuestion & { map: WorkMap; answer_clean?: string };

export function InboxScreen() {
  const [maps, setMaps] = useState<WorkMap[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);

  const load = () => getJson<WorkMap[]>("/api/workmaps").then(setMaps).catch(() => {});
  useEffect(() => {
    load();
    getJson<Expert[]>("/api/experts").then(setExperts).catch(() => {});
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const all: Item[] = maps.flatMap((m) => m.open_questions.map((q) => ({ ...q, map: m })));
  const open = all.filter((q) => q.status === "open").sort((a, b) => b.asked_by_count - a.asked_by_count);
  const answered = all.filter((q) => q.status === "answered");
  const expert = (n?: string) => experts.find((e) => e.name === n);

  return (
    <div className="screen inbox">
      <header>
        <h2>Expert Minute</h2>
        <p className="muted">Questions new hires hit that no task answers yet. About a minute each, by voice.</p>
      </header>

      {open.length === 0 ? (
        <p className="muted">Nothing waiting. Every question so far has been answered.</p>
      ) : (
        <ul className="inbox-list">
          {open.map((q) => (
            <QuestionCard key={`${q.map.id}.${q.id}`} item={q} expert={expert(q.route_to)} onAnswered={load} />
          ))}
        </ul>
      )}

      {answered.length > 0 && (
        <section>
          <h3 className="eyebrow">Answered</h3>
          <ul className="inbox-done">
            {answered.map((q) => (
              <li key={`${q.map.id}.${q.id}`}>
                <b>{q.q}</b>
                <q>{q.answer_clean ?? q.answer}</q>
                <span className="muted small">
                  {q.route_to} · added to <a href={`#/map/${q.map.id}`}>{q.map.workflow}</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuestionCard({ item: q, expert, onAnswered }: { item: Item; expert?: Expert; onAnswered: () => void }) {
  const [writing, setWriting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startVoice() {
    setPendingQuickAsk({
      workmapId: q.map.id,
      questionId: q.id,
      question: q.q,
      context: q.context,
      expert: q.route_to,
    });
    openSession(SESSION_ROUTES.quickAsk);
  }

  async function submit() {
    if (!answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postJson<WorkMap>("/api/patch", {
        workmapId: q.map.id,
        questionId: q.id,
        answer: answer.trim(),
        expert: q.route_to ?? q.map.expert,
      });
      onAnswered();
    } catch (err) {
      setError(`Could not update the Work Map: ${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <li className="card inbox-card">
      <span className="lib-pills">
        <span className="pill gap">
          Asked by {q.asked_by_count} {q.asked_by_count === 1 ? "person" : "people"}
        </span>
        <span className="pill line">{q.map.workflow}</span>
      </span>
      <b className="inbox-q">{q.q}</b>
      {q.context && <span className="muted small">Seen on: {q.context}</span>}
      <span className="small">
        For <b>{q.route_to ?? "unassigned"}</b>
        {expert && <span className="muted">, {expert.title}</span>}
      </span>
      {q.route_reason && <span className="muted small">{q.route_reason}</span>}

      {writing ? (
        <div className="inbox-answer">
          <textarea
            rows={3}
            autoFocus
            value={answer}
            placeholder="Your answer, in your own words"
            onChange={(e) => setAnswer(e.target.value)}
            disabled={busy}
          />
          <div className="row">
            <button type="button" className="primary" onClick={submit} disabled={busy || !answer.trim()}>
              {busy ? "Adding to the Work Map…" : "Save answer"}
            </button>
            <button type="button" className="quiet" onClick={() => setWriting(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <span className="err small">{error}</span>}
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" onClick={startVoice}>
            Start voice session
          </button>
          <button type="button" className="quiet" onClick={() => setWriting(true)}>
            Answer in text
          </button>
        </div>
      )}
    </li>
  );
}
