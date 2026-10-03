// Owner: Pablo. Learner › Knowledge Repository: one card per task (Work Map), and a task page
// with a walkthrough that plays the expert's step clips in sequence.
// Routes: #/learner/knowledge and #/learner/knowledge/<workmap id>.
import { useEffect, useMemo, useState } from "react";
import { ClipPlayer } from "../capture/ClipPlayer";
import { getJson } from "../shared/api";
import type { WorkMap } from "../shared/types";
import { MasteryPanel } from "./MasteryPanel";
import { computeMastery, useProgress, type StepStatus } from "./progress";
import "./screens.css";

/** Rough walkthrough length: each clip is ~3 s before to ~10 s after the moment. */
const SECONDS_PER_STEP = 13;
/** Without a recording, a step stays on screen this long when playing all. */
const SLIDE_MS = 7000;

// Placeholder tasks so the repository looks like a team's, not a single demo map.
const STUBS = [
  { workflow: "Month-end accrual check", expert: "Sabrina M.", note: "5 steps · walkthrough coming soon" },
  { workflow: "Supplier bank detail change", expert: "Jonas K.", note: "Not captured yet · 2 open questions" },
];

function useWorkMaps(pollMs = 0) {
  const [maps, setMaps] = useState<WorkMap[] | null>(null);
  useEffect(() => {
    const load = () => getJson<WorkMap[]>("/api/workmaps").then(setMaps).catch(() => setMaps((m) => m ?? []));
    load();
    addEventListener("focus", load);
    const id = pollMs ? setInterval(load, pollMs) : undefined;
    return () => {
      removeEventListener("focus", load);
      if (id) clearInterval(id);
    };
  }, [pollMs]);
  return maps;
}

/** Confirmed real maps first, then drafts, then the sample. */
const ordered = (maps: WorkMap[]) =>
  [...maps].sort(
    (a, b) =>
      Number(!!a.sample) - Number(!!b.sample) ||
      Number(b.confirmed) - Number(a.confirmed) ||
      b.updated_at.localeCompare(a.updated_at),
  );

export function KnowledgeRepository() {
  const maps = useWorkMaps(5000);
  const progress = useProgress();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const tasks = ordered(maps ?? []).filter(
    (m) => matches(m.workflow) || matches(m.expert) || m.steps.some((s) => matches(s.title)) || m.guardrails.some((g) => matches(g.text)),
  );

  return (
    <div className="screen kr">
      <header className="wm-head">
        <div>
          <h2>Knowledge Repository</h2>
          <p>Every task the experts have walked through, step by step, in their own words.</p>
        </div>
        <input
          className="kr-search"
          type="search"
          placeholder="Search tasks, steps or rules"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the Knowledge Repository"
        />
      </header>

      {maps === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="cards">
          {tasks.map((m) => {
            const mastery = computeMastery(m, progress);
            const open = m.open_questions.filter((x) => x.status === "open").length;
            const mins = Math.max(1, Math.round((m.steps.length * SECONDS_PER_STEP) / 60));
            return (
              <li key={m.id}>
                <a className="card lib-card kr-card" href={`#/learner/knowledge/${m.id}`}>
                  <span className="kr-thumb" aria-hidden="true">
                    <span className="kr-play" />
                    <span className="kr-len">{mins} min</span>
                  </span>
                  <span className="lib-pills">
                    <span className={`pill ${m.confirmed ? "ok" : "line"}`}>{m.confirmed ? "Confirmed" : "Draft"}</span>
                    {open > 0 && <span className="pill gap">{open} open</span>}
                    {m.sample && <span className="pill line">Sample</span>}
                  </span>
                  <b className="lib-name">{m.workflow}</b>
                  <span className="muted small">
                    Taught by {m.expert} · {m.team}
                  </span>
                  <span className="mono small">
                    {m.steps.length} steps · {m.guardrails.length} rules
                  </span>
                  <span className="meter" aria-hidden="true">
                    <span style={{ width: `${mastery.score ?? 0}%` }} />
                  </span>
                  <span className="muted small">
                    {mastery.score === null ? "Not started" : `${mastery.score}% mastered`}
                  </span>
                </a>
              </li>
            );
          })}
          {!q &&
            STUBS.map((s) => (
              <li key={s.workflow}>
                <div className="card lib-card kr-card stub">
                  <span className="kr-thumb empty" aria-hidden="true" />
                  <b className="lib-name">{s.workflow}</b>
                  <span className="muted small">Taught by {s.expert}</span>
                  <span className="mono small">{s.note}</span>
                </div>
              </li>
            ))}
          {tasks.length === 0 && q && <p className="muted">Nothing matches "{query}".</p>}
        </ul>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<StepStatus, string> = { mastered: "Mastered", practice: "Practice", not_seen: "" };

export function KnowledgeTask({ id }: { id: string }) {
  const [map, setMap] = useState<WorkMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playingAll, setPlayingAll] = useState(false);
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  const progress = useProgress();

  useEffect(() => {
    const load = () =>
      getJson<WorkMap>(`/api/workmaps/${id}`)
        .then((m) => {
          setMap(m);
          setError(null);
        })
        .catch(() => setError(`No task called "${id}".`));
    load();
    addEventListener("focus", load);
    return () => removeEventListener("focus", load);
  }, [id]);

  const steps = map?.steps ?? [];
  const step = steps[Math.min(index, steps.length - 1)];
  const status = useMemo(
    () => (map ? new Map(computeMastery(map, progress).steps.map((s) => [s.step.id, s.status])) : new Map()),
    [map, progress],
  );

  const next = () => {
    if (index < steps.length - 1) setIndex(index + 1);
    else setPlayingAll(false);
  };

  // Without a recording, "Play all" advances like a slideshow.
  useEffect(() => {
    if (!playingAll || hasVideo !== false) return;
    const t = setTimeout(next, SLIDE_MS);
    return () => clearTimeout(t);
  });

  if (error) return <p className="muted">{error}</p>;
  if (!map || !step) return <p className="muted">Loading…</p>;

  const guardrail = (gid: string) => map.guardrails.find((g) => g.id === gid);
  const open = map.open_questions.filter((q) => q.status === "open");

  return (
    <div className="screen kt">
      <a className="back" href="#/learner/knowledge">← Knowledge Repository</a>
      <header className="wm-head">
        <div>
          <h2>{map.workflow}</h2>
          <p>
            Taught by {map.expert} · {map.team}
          </p>
        </div>
        <div className="wm-stats">
          <span className={`pill ${map.confirmed ? "ok" : "line"}`}>{map.confirmed ? `Confirmed by ${map.expert}` : "Draft"}</span>
          <a className="btn" href="/erp/#/teach" target="_blank" rel="noreferrer">
            Practice in the ERP ↗
          </a>
        </div>
      </header>

      <div className="kt-body">
        <section className="kt-player" aria-label="Walkthrough">
          <div className="kt-stage">
            {hasVideo === false ? (
              <div className="kt-slide">
                <span className="kt-slide-n">Step {index + 1}</span>
                <b>{step.title}</b>
                <span>{step.decision}</span>
                <small>No screen recording for this task yet. The walkthrough shows the steps.</small>
              </div>
            ) : null}
            <div hidden={hasVideo === false}>
              <ClipPlayer
                key={step.id}
                at={step.moment.clip_s}
                sessionId={step.moment.session ?? (map.sample ? undefined : map.id)}
                autoPlay={playingAll || index > 0}
                onClipEnd={() => playingAll && next()}
                onAvailable={setHasVideo}
              />
            </div>
          </div>

          <div className="kt-controls">
            <button type="button" className="quiet" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              ← Previous
            </button>
            <span className="mono small">
              Step {index + 1} of {steps.length}
            </span>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (!playingAll && index === steps.length - 1) setIndex(0);
                setPlayingAll(!playingAll);
              }}
            >
              {playingAll ? "Pause walkthrough" : index === 0 ? "▶ Play walkthrough" : "▶ Play from here"}
            </button>
            <button type="button" className="quiet" onClick={next} disabled={index === steps.length - 1}>
              Next →
            </button>
          </div>

          <article className="kt-caption">
            <h3>{step.title}</h3>
            <p>{step.decision}</p>
            <blockquote>
              <q>{step.reason}</q>
              <cite>
                {map.expert}, {step.said_at === "quick ask" ? "Expert Minute" : `at ${step.said_at}`}
              </cite>
            </blockquote>
            {step.guardrails.length > 0 && (
              <div className="wm-grs">
                {step.guardrails.map((gid) => (
                  <mark key={gid} className="gr">
                    {guardrail(gid)?.text ?? gid}
                  </mark>
                ))}
              </div>
            )}
          </article>
        </section>

        <aside className="kt-side">
          <ol className="kt-chapters">
            {steps.map((s, i) => {
              const st: StepStatus = status.get(s.id) ?? "not_seen";
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`kt-chapter${i === index ? " on" : ""}`}
                    onClick={() => {
                      setIndex(i);
                      setPlayingAll(false);
                    }}
                    aria-current={i === index ? "step" : undefined}
                  >
                    <span className="wm-n">{i + 1}</span>
                    <span className="kt-chapter-title">{s.title}</span>
                    {st !== "not_seen" && <span className={`kt-st ${st}`}>{STATUS_LABEL[st]}</span>}
                  </button>
                </li>
              );
            })}
          </ol>

          <MasteryPanel map={map} />

          <div className="kt-ask">
            <b>Something not covered?</b>
            <span className="muted small">
              {open.length > 0
                ? `${open.length} question${open.length > 1 ? "s" : ""} about this task are with the experts.`
                : "Ask the experts. Your question is routed to whoever knows best."}
            </span>
            <a className="btn" href="#/learner/minute">
              Ask a question
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
