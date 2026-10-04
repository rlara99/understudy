// Owner: Pablo. Work Map timeline: moment, decision, reason in the expert's words, guardrails.
// Click a step to replay the expert's screen at that moment.
// Delete a step from its detail panel (its own guardrails go with it) or the whole task from the header.
import { useEffect, useState } from "react";
import { ClipPlayer } from "../capture/ClipPlayer";
import { getJson } from "../shared/api";
import { ConfirmDelete } from "../shared/ConfirmDelete";
import { deleteStep, deleteWorkMap } from "../shared/deletes";
import type { WorkMap } from "../shared/types";
import "./screens.css";

export function WorkMapScreen({ id }: { id: string }) {
  const [map, setMap] = useState<WorkMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Reload on focus so a debrief correction or a Quick Ask patch shows up without a refresh.
  useEffect(() => {
    const load = () =>
      getJson<WorkMap>(`/api/workmaps/${id}`)
        .then((m) => {
          setMap(m);
          setError(null);
        })
        .catch(() => setError(`No Work Map called "${id}".`));
    load();
    addEventListener("focus", load);
    return () => removeEventListener("focus", load);
  }, [id]);

  if (error) return <p className="muted">{error}</p>;
  if (!map) return <p className="muted">Loading…</p>;

  const guardrail = (gid: string) => map.guardrails.find((g) => g.id === gid);
  const step = map.steps.find((s) => s.id === selected) ?? map.steps[0];
  const open = map.open_questions.filter((q) => q.status === "open");

  return (
    <div className="screen wm">
      <header className="wm-head">
        <div>
          <h2>{map.workflow}</h2>
          <p className="muted">
            {map.expert} · {map.team}
          </p>
        </div>
        <div className="wm-stats">
          <span className={`pill ${map.confirmed ? "ok" : "line"}`}>
            {map.confirmed ? `Confirmed by ${map.expert}` : "Draft: waiting for teach-back"}
          </span>
          <span className="pill line">
            {map.steps.length} steps · {map.guardrails.length} guardrails
          </span>
          {open.length > 0 && <span className="pill gap">{open.length} open</span>}
          <ConfirmDelete
            label="Delete task"
            what="this task and its walkthrough"
            onConfirm={async () => {
              await deleteWorkMap(map.id);
              location.hash = "#/learner/knowledge";
            }}
          />
        </div>
      </header>

      <div className="wm-body">
        <ol className="wm-steps">
          {map.steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`wm-step${s.id === step?.id ? " on" : ""}`}
                onClick={() => setSelected(s.id)}
              >
                <span className="wm-n">{i + 1}</span>
                <span className="wm-step-main">
                  <span className="wm-step-title">{s.title}</span>
                  <span className="muted small">{s.decision}</span>
                </span>
                <span className="t">{s.moment.t}</span>
              </button>
            </li>
          ))}
        </ol>

        {step && (
          <article className="wm-detail" aria-live="polite">
            <ClipPlayer key={step.id} at={step.moment.clip_s} sessionId={step.moment.session ?? (map.sample ? undefined : map.id)} />
            <div className="wm-detail-head">
              <b>
                Step {map.steps.indexOf(step) + 1}: {step.title}
              </b>
              <ConfirmDelete
                label="Delete step"
                what="this step"
                onConfirm={async () => {
                  setMap(await deleteStep(map.id, step.id));
                  setSelected(null);
                }}
              />
            </div>
            <dl className="wm-facts">
              <dt>Moment</dt>
              <dd>
                <span className="t">{step.moment.t}</span>
              </dd>
              <dt>Decision</dt>
              <dd>{step.decision}</dd>
              <dt>Reason</dt>
              <dd>
                <q>{step.reason}</q>{" "}
                <span className="muted">
                  {map.expert}, {step.said_at === "quick ask" ? "Quick Ask" : `said at ${step.said_at}`}
                </span>
              </dd>
              {step.guardrails.length > 0 && (
                <>
                  <dt>Guardrails</dt>
                  <dd className="wm-grs">
                    {step.guardrails.map((gid) => {
                      const g = guardrail(gid);
                      return (
                        <div key={gid}>
                          <mark className="gr">{g?.text ?? gid}</mark>
                          {g?.quote && (
                            <span className="muted small">
                              {" "}
                              <q>{g.quote}</q>
                              {g.said_at && ` · ${g.said_at}`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </dd>
                </>
              )}
            </dl>
          </article>
        )}
      </div>

      {open.length > 0 && (
        <section className="wm-open">
          <h3>Not covered yet</h3>
          <ul>
            {open.map((q) => (
              <li key={q.id}>
                {q.q}{" "}
                <span className="muted small">
                  {q.route_to ? `→ ${q.route_to}` : "unassigned"} · asked by {q.asked_by_count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
