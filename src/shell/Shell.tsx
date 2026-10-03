// Owner: Pablo. Understudy's app shell: left sidebar with an Expert/Learner switch and each
// mode's modules. Same UI in the browser (localhost:5173) and inside the Electron window.
// Live sessions (work/live, work/record, learner/assistant, panel) start through openSession():
// a small always-on-top companion window on desktop, this tab in a browser.
import { useEffect, useState, type ReactNode } from "react";
import { ApprenticePanel } from "../panel/ApprenticePanel";
import { TutorPanel } from "../panel/TutorPanel";
import { inCompanion, isDesktop, openSession, SESSION_ROUTES } from "../shared/desktop";
import { getJson } from "../shared/api";
import type { WorkMap } from "../shared/types";
import { InboxScreen } from "../screens/InboxScreen";
import { KnowledgeRepository, KnowledgeTask } from "../screens/KnowledgeRepository";
import { LearnerMinute } from "../screens/LearnerMinute";
import { LibraryScreen } from "../screens/LibraryScreen";
import { resetDemo } from "../screens/resetDemo";
import { WorkMapScreen } from "../screens/WorkMapScreen";
import "./shell.css";

type Mode = "expert" | "learner";

/** The separate work app. Same Vite server, its own page. */
const ERP_URL = "/erp/";

interface Module {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  /** Routes that highlight this module (first one is where the nav item goes). */
  routes: string[];
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const MODULES: Record<Mode, Module[]> = {
  expert: [
    {
      id: "live",
      label: "Work mode: live",
      hint: "Claudia asks why while you work",
      icon: <Icon d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />,
      routes: ["expert/live", SESSION_ROUTES.workLive, SESSION_ROUTES.quickAsk],
    },
    {
      id: "record",
      label: "Work mode: record",
      hint: "Silent recording, no questions",
      icon: <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
      routes: ["expert/record", SESSION_ROUTES.workRecord],
    },
    {
      id: "debrief",
      label: "Debrief and teach",
      hint: "Turn sessions into Work Maps",
      icon: <Icon d="M4 5h16v11H8l-4 4V5zM8 9h8M8 12h5" />,
      routes: ["expert/debrief", "map", "library"],
    },
    {
      id: "minute",
      label: "Expert Minute",
      hint: "Answer new hires' questions",
      icon: <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
      routes: ["expert/minute", "inbox"],
    },
  ],
  learner: [
    {
      id: "assistant",
      label: "Assistant",
      hint: "Tips while you work",
      icon: <Icon d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />,
      routes: ["learner/assist", SESSION_ROUTES.assistant, "tutor"],
    },
    {
      id: "knowledge",
      label: "Knowledge Repository",
      hint: "Tasks with walkthrough videos",
      icon: <Icon d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5v-15zM4 19.5A1.5 1.5 0 0 0 5.5 21H20" />,
      routes: ["learner/knowledge"],
    },
    {
      id: "minute",
      label: "Expert Minute",
      hint: "Ask the experts",
      icon: <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" />,
      routes: ["learner/minute"],
    },
  ],
};

const MODE_KEY = "understudy.mode";

function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

const startsWith = (route: string, prefix: string) => route === prefix || route.startsWith(`${prefix}/`);

function modeOf(route: string): Mode | null {
  for (const mode of ["expert", "learner"] as Mode[]) {
    if (MODULES[mode].some((m) => m.routes.some((r) => startsWith(route, r)))) return mode;
  }
  return null;
}

function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "learner" ? "learner" : "expert";
  } catch {
    return "expert";
  }
}

export function Shell() {
  const route = useRoute();
  const mode = modeOf(route) ?? storedMode();

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* not remembered */
    }
  }, [mode]);

  // Land on the first module of the last mode used.
  useEffect(() => {
    if (!route) location.replace(`#/${MODULES[storedMode()][0].routes[0]}`);
  }, [route]);

  const body = renderRoute(route);
  // The desktop companion window is small: just the session, no sidebar.
  if (inCompanion()) return <main className="companion">{body}</main>;

  const active = MODULES[mode].find((m) => m.routes.some((r) => startsWith(route, r)));

  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true" />
          <b>Understudy</b>
        </a>

        <div className="mode-switch" role="tablist" aria-label="Mode">
          {(["expert", "learner"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "on" : ""}
              onClick={() => (location.hash = `#/${MODULES[m][0].routes[0]}`)}
            >
              {m === "expert" ? "Expert" : "Learner"}
            </button>
          ))}
        </div>

        <nav className="modules" aria-label={`${mode} modules`}>
          {MODULES[mode].map((m) => (
            <a key={m.id} href={`#/${m.routes[0]}`} className={active?.id === m.id ? "on" : ""} aria-current={active?.id === m.id ? "page" : undefined}>
              {m.icon}
              <span>
                <b>{m.label}</b>
                <small>{m.hint}</small>
              </span>
            </a>
          ))}
        </nav>

        <div className="side-foot">
          <a className="side-link" href={mode === "learner" ? `${ERP_URL}#/teach` : ERP_URL} target="_blank" rel="noreferrer">
            Open the work app (ERP) ↗
          </a>
          <ResetButton />
        </div>
      </aside>

      <main className="shell-main">{body}</main>
    </div>
  );
}

function renderRoute(route: string): ReactNode {
  const [a, b, c] = route.split("/");
  const r = b ? `${a}/${b}` : a;

  // Sessions (companion window on desktop)
  if (r === SESSION_ROUTES.workLive || r === SESSION_ROUTES.quickAsk) return <ApprenticePanel />;
  if (r === SESSION_ROUTES.assistant || r === "tutor") return <TutorPanel />;
  if (r === SESSION_ROUTES.workRecord) return <ComingSoon title="Work mode: record and learn" />;

  // Expert
  if (r === "expert/live") return <LiveLauncher />;
  if (r === "expert/record") return <RecordLauncher />;
  if (r === "expert/debrief") return <DebriefHome />;
  if (r === "library") return <LibraryScreen />;
  if (r === "expert/minute" || r === "inbox") return <InboxScreen />;
  if (a === "map" && b) return <WorkMapScreen id={b} />;

  // Learner
  if (r === "learner/assist") return <AssistantLauncher />;
  if (r === "learner/knowledge") return c ? <KnowledgeTask id={c} /> : <KnowledgeRepository />;
  if (r === "learner/minute") return <LearnerMinute />;

  if (a === "erp") return <ErpMoved />;
  return null;
}

/* ---------- small pages ---------- */

function Launcher(props: {
  eyebrow: string;
  title: string;
  lede: string;
  points: string[];
  start: string;
  onStart: () => void;
  erpHref?: string;
  erpLabel?: string;
}) {
  return (
    <div className="screen launcher">
      <div className="launch-card">
        <span className="eyebrow">{props.eyebrow}</span>
        <h2>{props.title}</h2>
        <p className="lede">{props.lede}</p>
        <ul className="launch-points">
          {props.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="primary big" onClick={props.onStart}>
            {props.start}
          </button>
          {props.erpHref && (
            <a className="btn" href={props.erpHref} target="_blank" rel="noreferrer">
              {props.erpLabel ?? "Open the work app ↗"}
            </a>
          )}
        </div>
        <p className="muted small">
          {isDesktop()
            ? "Opens in a small window that stays on top while you work in other apps."
            : "Runs in this tab. Keep the work app open in another tab or window."}
        </p>
      </div>
    </div>
  );
}

function LiveLauncher() {
  return (
    <Launcher
      eyebrow="Expert · Work mode"
      title="Live: teach Claudia while you work"
      lede="Share your screen and do the task as usual. Claudia stays quiet while you type and asks why at the moments that matter."
      points={[
        "Questions at natural pauses, about what's on screen",
        "Off the record any time: the button in the ERP, the panel, or just say “off the record”",
        "Finish the task, answer a short debrief, confirm the Work Map",
      ]}
      start="Start live session"
      onStart={() => openSession(SESSION_ROUTES.workLive)}
      erpHref={ERP_URL}
    />
  );
}

function RecordLauncher() {
  return (
    <Launcher
      eyebrow="Expert · Work mode"
      title="Record and learn"
      lede="A silent session: Claudia records your screen and voice, transcribes it and asks nothing. You debrief later, in one go."
      points={["No interruptions while you work", "Call audio only if you opt in", "Feeds the next debrief"]}
      start="Start recording"
      onStart={() => openSession(SESSION_ROUTES.workRecord)}
      erpHref={ERP_URL}
    />
  );
}

function AssistantLauncher() {
  return (
    <Launcher
      eyebrow="Learner"
      title="Assistant: work with the expert's know-how beside you"
      lede="Claudia follows your work, explains each step the way the expert would, and stops you before a rule is broken."
      points={[
        "Predict first, then hear the expert's reason and see their clip",
        "Ask anything while you work",
        "What she doesn't know goes to the right expert",
      ]}
      start="Start assistant"
      onStart={() => openSession(SESSION_ROUTES.assistant)}
      erpHref={`${ERP_URL}#/teach`}
      erpLabel="Open the ERP as Lena ↗"
    />
  );
}

function DebriefHome() {
  const [maps, setMaps] = useState<WorkMap[] | null>(null);
  useEffect(() => {
    getJson<WorkMap[]>("/api/workmaps").then(setMaps).catch(() => setMaps([]));
  }, []);
  const sorted = [...(maps ?? [])].sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || b.updated_at.localeCompare(a.updated_at));
  return (
    <div className="screen">
      <header className="wm-head">
        <div>
          <h2>Debrief and teach</h2>
          <p>Your Work Maps. Drafts need a short spoken debrief before new hires learn from them.</p>
        </div>
      </header>
      <div className="note-card">
        Today a debrief runs at the end of a live session: <b>Finish task → Start debrief → Confirm</b>. A debrief over a whole day of recordings is
        coming next.
      </div>
      {maps === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="cards">
          {sorted.map((m) => {
            const open = m.open_questions.filter((q) => q.status === "open").length;
            return (
              <li key={m.id}>
                <a className="card lib-card" href={`#/map/${m.id}`}>
                  <span className="lib-pills">
                    <span className={`pill ${m.confirmed ? "ok" : "line"}`}>{m.confirmed ? "Confirmed" : "Needs debrief"}</span>
                    {open > 0 && <span className="pill gap">{open} open</span>}
                    {m.sample && <span className="pill line">Sample</span>}
                  </span>
                  <b className="lib-name">{m.workflow}</b>
                  <span className="muted small">
                    {m.expert} · updated {new Date(m.updated_at).toLocaleDateString()}
                  </span>
                  <span className="mono small">
                    {m.steps.length} steps · {m.guardrails.length} rules
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small">
        Coverage and new-hire mastery for every map: <a href="#/library">Know-how overview</a>.
      </p>
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="screen launcher">
      <div className="launch-card">
        <span className="eyebrow">In progress</span>
        <h2>{title}</h2>
        <p className="lede">This session is being built. Use Work mode: live in the meantime.</p>
        <a className="btn" href="#/expert/live">
          Go to Work mode: live
        </a>
      </div>
    </div>
  );
}

function ErpMoved() {
  return (
    <div className="screen launcher">
      <div className="launch-card">
        <span className="eyebrow">Moved</span>
        <h2>The ERP is its own app now</h2>
        <p className="lede">It's the work software people use, not part of Understudy. Open it in its own window.</p>
        <div className="row">
          <a className="btn" href={ERP_URL} target="_blank" rel="noreferrer">
            ERP as Sabrina (expert) ↗
          </a>
          <a className="btn" href={`${ERP_URL}#/teach`} target="_blank" rel="noreferrer">
            ERP as Lena (trainee) ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function ResetButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="quiet side-reset"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Reset the demo? Restores the ERP's invoices and the sample Work Map, and clears progress, recordings and your questions.")) return;
        setBusy(true);
        try {
          await resetDemo();
        } finally {
          setBusy(false);
          location.reload();
        }
      }}
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}
