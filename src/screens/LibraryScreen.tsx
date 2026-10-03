// Owner: Pablo. Know-how Library: one card per Work Map with coverage counts, new-hire
// mastery and open questions. Polls so the badge clears on its own after a Quick Ask patch.
import { useEffect, useState } from "react";
import { getJson } from "../shared/api";
import type { WorkMap } from "../shared/types";
import { computeMastery, onProgress, readProgress } from "./progress";
import { resetDemo } from "./resetDemo";
import "./screens.css";

// Placeholder cards so the library looks like a team's, not a single demo map.
const STUBS = [
  { workflow: "Month-end accrual check", who: "Sabrina M. · Accounts payable", stats: "5 steps · 2 guardrails", pill: ["ok", "Confirmed"] },
  { workflow: "Supplier bank detail change", who: "Jonas K. · Vendor master data", stats: "2 open questions · no session yet", pill: ["gap", "Needs capture"] },
] as const;

export function LibraryScreen() {
  const [maps, setMaps] = useState<WorkMap[]>([]);
  const [progress, setProgress] = useState(readProgress);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const load = () => getJson<WorkMap[]>("/api/workmaps").then(setMaps).catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => onProgress(setProgress), []);

  const sorted = [...maps].sort((a, b) => Number(!!a.sample) - Number(!!b.sample) || b.updated_at.localeCompare(a.updated_at));
  const allGuardrails = maps.flatMap((m) => m.guardrails.map((g) => ({ ...g, key: `${m.id}.${g.id}` })));

  async function reset() {
    if (!confirm("Reset the demo? Clears new-hire progress, ERP edits and recordings, and restores the sample Work Map.")) return;
    setResetting(true);
    try {
      await resetDemo();
      setMaps(await getJson<WorkMap[]>("/api/workmaps"));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="screen lib">
      <header className="lib-head">
        <div>
          <h2>Know-how Library</h2>
          <p className="muted">What the team knows, who it came from, and what nobody has explained yet.</p>
        </div>
        <button type="button" className="quiet" onClick={reset} disabled={resetting}>
          {resetting ? "Resetting…" : "Reset demo"}
        </button>
      </header>

      <ul className="cards">
        {sorted.map((m) => {
          const open = m.open_questions.filter((q) => q.status === "open");
          const asked = open.reduce((n, q) => n + q.asked_by_count, 0);
          const mastery = computeMastery(m, progress);
          return (
            <li key={m.id}>
              <a className="card lib-card" href={`#/map/${m.id}`}>
                <span className="lib-pills">
                  <span className={`pill ${m.confirmed ? "ok" : "line"}`}>{m.confirmed ? "Confirmed" : "Draft"}</span>
                  {open.length > 0 && (
                    <span className="pill gap" title={`Asked by ${asked} ${asked === 1 ? "person" : "people"}`}>
                      {open.length} open
                    </span>
                  )}
                  {m.sample && <span className="pill line">Sample</span>}
                </span>
                <b className="lib-name">{m.workflow}</b>
                <span className="muted small">
                  {m.expert} · {m.team}
                </span>
                <span className="mono small">
                  {m.steps.length} steps · {m.guardrails.length} guardrails
                </span>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${mastery.score ?? 0}%` }} />
                </span>
                <span className="muted small">
                  {mastery.score === null ? "New hire: not started" : `New hire: ${mastery.score}% mastered`}
                </span>
              </a>
            </li>
          );
        })}
        {STUBS.map((s) => (
          <li key={s.workflow}>
            <div className="card lib-card stub">
              <span className="lib-pills">
                <span className={`pill ${s.pill[0]}`}>{s.pill[1]}</span>
              </span>
              <b className="lib-name">{s.workflow}</b>
              <span className="muted small">{s.who}</span>
              <span className="mono small">{s.stats}</span>
            </div>
          </li>
        ))}
      </ul>

      {allGuardrails.length > 0 && (
        <section>
          <h3 className="eyebrow">Guardrails across all workflows</h3>
          <div className="chips">
            {allGuardrails.map((g) => (
              <span key={g.key} className="chip">
                <i aria-hidden="true" />
                {g.text}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
