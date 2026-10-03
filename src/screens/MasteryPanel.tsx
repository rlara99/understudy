// Owner: Pablo. New hire's progress against the Work Map: mastered steps, steps to practice,
// and questions sent back to the expert. Shown in the ERP's teach mode.
import { useEffect, useState } from "react";
import type { WorkMap } from "../shared/types";
import { computeMastery, onProgress, readProgress } from "./progress";
import "./screens.css";

export function MasteryPanel({ map }: { map: WorkMap }) {
  const [progress, setProgress] = useState(readProgress);
  useEffect(() => onProgress(setProgress), []);

  const m = computeMastery(map, progress);
  const practice = m.steps.filter((s) => s.status === "practice");
  const mastered = m.steps.filter((s) => s.status === "mastered");
  const flagged = map.open_questions.filter((q) => q.status === "open");

  return (
    <section className="mastery" aria-label="Your progress">
      <div className="mastery-head">
        <span>Your progress</span>
        <b>{m.score === null ? "–" : `${m.score}%`}</b>
      </div>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${m.score ?? 0}%` }} />
      </div>

      {practice.length > 0 && (
        <div className="mastery-group">
          <div className="mastery-label practice">Practice next</div>
          {practice.map(({ step, invoices }) => (
            <div key={step.id} className="mastery-item">
              <b>{step.title}</b>
              <q>{step.reason}</q>
              <span className="muted">Caught on {invoices.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {mastered.length > 0 && (
        <div className="mastery-group">
          <div className="mastery-label ok">Mastered</div>
          {mastered.map(({ step, invoices }) => (
            <div key={step.id} className="mastery-item">
              <b>{step.title}</b>
              <span className="muted">{invoices.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {flagged.length > 0 && (
        <div className="mastery-group">
          <div className="mastery-label gap">Asked the expert</div>
          {flagged.map((q) => (
            <div key={q.id} className="mastery-item">
              <span>{q.q}</span>
              {q.route_to && <span className="muted">Waiting for {q.route_to}</span>}
            </div>
          ))}
        </div>
      )}

      {m.score === null && flagged.length === 0 && (
        <p className="muted small">Save an invoice to see which of {map.expert}'s steps you've got.</p>
      )}
    </section>
  );
}
