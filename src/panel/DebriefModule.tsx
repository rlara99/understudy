// Owner: Renzo. Expert · Debrief & teach. During or at the end of the day:
// pick the recorded sessions (live + record & learn) → draft Work Map + gaps → a 5-minute spoken debrief
// with Claudia (gaps, then a teach-back) → Confirm → the confirmed Work Map feeds the learners.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { AGENT_NAME, DEBRIEF_FIRST_MESSAGE, INTERVIEWER_PROMPT } from "../agents/prompts";
import { getJson, postJson } from "../shared/api";
import { formatMs } from "../shared/bus";
import { ConfirmDelete } from "../shared/ConfirmDelete";
import { deleteSession } from "../shared/deletes";
import type { SessionLog, TranscriptLine, WorkMap } from "../shared/types";
import "./session.css";
import { useMicHold } from "./useMicHold";

type SessionSummary = Omit<SessionLog, "events" | "transcript"> & { event_count: number; transcript_count: number };
type Phase = "pick" | "mapping" | "ready" | "debrief" | "confirming" | "done";

const EXPERT = "Sabrina M.";
const TEAM = "Accounts payable";
const LIMIT_S = 300; // 5 minutes
const WRAP_AT_S = 225; // 3:45 → skip remaining questions, do the teach-back
const END_AT_S = 280; // 4:40 → finish and ask to confirm

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function mapForAgent(map: WorkMap): string {
  return JSON.stringify({
    steps: map.steps.map((s) => ({ title: s.title, decision: s.decision, reason: s.reason, guardrails: s.guardrails })),
    guardrails: map.guardrails.map((g) => ({ id: g.id, text: g.text })),
  });
}

function Debrief() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [map, setMap] = useState<WorkMap | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [secs, setSecs] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t0 = useRef(0);
  const stage = useRef(0); // 0 waiting for greeting, 1 greeting, 2 gaps sent
  const mapRef = useRef(map);
  mapRef.current = map;
  const gapsRef = useRef(gaps);
  gapsRef.current = gaps;
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    getJson<SessionSummary[]>("/api/sessions")
      .then((all) => {
        const work = all.filter((s) => s.mode === "live" || s.mode === "record" || s.mode === "capture");
        setSessions(work);
        setSelected(work.filter((s) => isToday(s.started_at) && !s.reviewed_in).map((s) => s.id));
      })
      .catch((e) => setError(`Could not load sessions: ${String(e)}`));
  }, []);

  const sendGaps = () => {
    if (stage.current === 2 || !mapRef.current) return;
    stage.current = 2;
    conv.current.sendContextualUpdate(`[WORKMAP] ${mapForAgent(mapRef.current)}`);
    const list = gapsRef.current.map((g, i) => `${i + 1}. ${g}`).join("\n");
    say(
      `[GAPS]\n${list || "No open gaps. Go straight to the teach-back."}\nYou have 5 minutes. Ask about these one at a time, then explain the whole process back.`,
    );
  };

  const mic = useMicHold();
  const conversation = useConversation({
    micMuted: mic.held, // closed while Claudia prepares/says a reply, so noise can't cut the play-back off
    onModeChange: ({ mode }) => {
      mic.onMode(mode);
      setAgentSpeaking(mode === "speaking");
      if (mode === "speaking" && stage.current === 0) stage.current = 1;
      else if (mode === "listening" && stage.current === 1) sendGaps();
    },
    onConnect: () =>
      setTimeout(() => {
        if (!conv.current.isSpeaking) sendGaps();
      }, 8000),
    onMessage: ({ message, role }) => {
      setLines((l) => [...l, { t: Date.now() - t0.current, speaker: role === "agent" ? "agent" : "expert", text: message }]);
    },
    onError: (m) => setError(String(m)),
  });
  const connected = conversation.status === "connected";
  const conv = useRef(conversation);
  conv.current = conversation;
  /** Send Claudia a message she should answer, with the mic closed until she has. */
  const say = (text: string) => {
    mic.hold(5000);
    conv.current.sendUserMessage(text);
  };

  // 5-minute clock with wrap-up nudges.
  useEffect(() => {
    if (phase !== "debrief" || !connected) return;
    let wrap = false;
    let end = false;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - t0.current) / 1000);
      setSecs(s);
      if (s >= WRAP_AT_S && !wrap) {
        wrap = true;
        say("[WRAP UP] About a minute left. Skip any remaining questions. Do the teach-back now, under 30 seconds.");
      }
      if (s >= END_AT_S && !end) {
        end = true;
        say("[TIME UP] Finish in one sentence and ask the expert to press Confirm.");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, connected]);

  const prepare = async () => {
    setError(null);
    setPhase("mapping");
    try {
      // If everything selected shares one name, that name becomes the Work Map's title.
      const names = [...new Set((sessions ?? []).filter((s) => selected.includes(s.id)).map((s) => s.name))];
      const workflow = names.length === 1 && names[0] ? names[0] : undefined;
      const r = await postJson<{ map: WorkMap; gaps: string[] }>("/api/map", { sessionIds: selected, workflow, expert: EXPERT, team: TEAM });
      setMap(r.map);
      setGaps(r.gaps);
      setPhase("ready");
    } catch (e) {
      setError(`Could not build the draft: ${String(e)}`);
      setPhase("pick");
    }
  };

  const startDebrief = () => {
    stage.current = 0;
    t0.current = Date.now();
    setLines([]);
    setSecs(0);
    setPhase("debrief");
    conversation.startSession({
      agentId: import.meta.env.VITE_INTERVIEWER_AGENT_ID,
      connectionType: "webrtc",
      dynamicVariables: { mode: "debrief", expert_name: EXPERT.split(" ")[0], agent_name: AGENT_NAME },
      overrides: { agent: { prompt: { prompt: INTERVIEWER_PROMPT }, firstMessage: DEBRIEF_FIRST_MESSAGE } },
    });
  };

  const confirm = async () => {
    if (!map) return;
    setPhase("confirming");
    if (connected) conversation.endSession();
    try {
      const r = await postJson<{ map: WorkMap; gaps: string[] }>("/api/map", {
        sessionIds: selected,
        mapId: map.id,
        workflow: map.workflow,
        expert: EXPERT,
        team: TEAM,
        confirm: true,
        debrief: linesRef.current,
      });
      setMap(r.map);
      setGaps(r.gaps);
      setPhase("done");
    } catch (e) {
      setError(`Could not confirm: ${String(e)}`);
      setPhase("debrief");
    }
  };

  // One row per named session: all its parts (continued sessions) are debriefed together.
  const groups = (() => {
    const map = new Map<string, { key: string; label: string; parts: SessionSummary[]; last: string }>();
    for (const s of sessions ?? []) {
      const key = s.name ?? s.id;
      const g = map.get(key) ?? { key, label: s.name ?? s.title ?? (s.mode === "record" ? "Record & learn" : "Live session"), parts: [], last: s.started_at };
      g.parts.push(s);
      if (s.started_at > g.last) g.last = s.started_at;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
  })();
  const toggleGroup = (ids: string[]) =>
    setSelected((s) => (ids.every((id) => s.includes(id)) ? s.filter((x) => !ids.includes(x)) : [...new Set([...s, ...ids])]));
  // Sections by day (a named session sits under the day of its latest part).
  const dayKey = (iso: string) => new Date(iso).toDateString();
  const dayLabel = (key: string) => {
    const d = new Date(key);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === new Date().toDateString()) return "Today";
    if (key === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };
  const days: { key: string; groups: typeof groups }[] = [];
  for (const g of groups) {
    const key = dayKey(g.last);
    const day = days.find((d) => d.key === key) ?? (days.push({ key, groups: [] }), days[days.length - 1]);
    day.groups.push(g);
  }
  if (!days.some((d) => d.key === new Date().toDateString())) days.unshift({ key: new Date().toDateString(), groups: [] });
  const shownDays = days.slice(0, 14);

  const removeSessions = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => deleteSession(id)));
      setSessions((all) => (all ?? []).filter((s) => !ids.includes(s.id)));
      setSelected((sel) => sel.filter((id) => !ids.includes(id)));
    } catch (e) {
      setError(`Could not delete: ${String(e)}`);
    }
  };

  return (
    <div className="ws" style={{ maxWidth: 720 }}>
      <header>
        <h2 style={{ margin: 0 }}>Debrief &amp; teach</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Five minutes with {AGENT_NAME} on what she saw today. She asks what's unclear, plays it back, and you confirm.
        </p>
      </header>

      {phase === "pick" && (
        <section className="ws-setup">
          {sessions === null && <p className="muted">Loading sessions…</p>}
          {sessions !== null &&
            shownDays.map((day) => {
              // Every session file started that day (parts of a name can span days; only this day's go).
              const dayIds = (sessions ?? []).filter((x) => dayKey(x.started_at) === day.key).map((x) => x.id);
              const label = dayLabel(day.key);
              return (
                <div key={day.key} className="ws-day">
                  <div className="ws-day-head">
                    <h3 className="eyebrow" style={{ margin: 0 }}>
                      {label}
                      {dayIds.length ? ` · ${dayIds.length} recording${dayIds.length === 1 ? "" : "s"}` : ""}
                    </h3>
                    {dayIds.length > 0 && (
                      <label className="ws-day-select small">
                        <input
                          type="checkbox"
                          checked={dayIds.every((id) => selected.includes(id))}
                          onChange={() => toggleGroup(dayIds)}
                        />{" "}
                        Select day
                      </label>
                    )}
                  </div>
                  {day.groups.length === 0 && (
                    <p className="muted small" style={{ margin: 0 }}>
                      {label === "Today" ? "No sessions recorded today yet. Start Work mode first." : "No sessions this day."}
                    </p>
                  )}
                  {day.groups.map((g) => {
                    const ids = g.parts.map((x) => x.id);
                    const events = g.parts.reduce((n, x) => n + x.event_count, 0);
                    const lines = g.parts.reduce((n, x) => n + x.transcript_count, 0);
                    const kinds = [...new Set(g.parts.map((x) => (x.mode === "record" ? "recorded" : "live")))].join(" + ");
                    return (
                      <label key={g.key} className="ws-check">
                        <input type="checkbox" checked={ids.every((id) => selected.includes(id))} onChange={() => toggleGroup(ids)} />
                        <span>
                          <b>{g.label}</b>
                          <span className="muted small">
                            {timeOf(g.last)} · {kinds}
                            {g.parts.length > 1 ? ` · ${g.parts.length} parts` : ""} · {events} events · {lines} lines
                            {g.parts.every((x) => x.reviewed_in) ? " · already reviewed" : ""}
                          </span>
                        </span>
                        <span style={{ marginLeft: "auto" }}>
                          <ConfirmDelete
                            what={g.parts.length > 1 ? `all ${g.parts.length} parts and their recordings` : "this session and its recording"}
                            onConfirm={() => removeSessions(ids)}
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          <div className="ws-actions ws-pick-actions">
            <button type="button" className="ws-primary" disabled={selected.length === 0} onClick={prepare}>
              Prepare debrief ({selected.length} recording{selected.length === 1 ? "" : "s"})
            </button>
            {selected.length > 0 && (
              <ConfirmDelete
                label={`Delete selected (${selected.length})`}
                what={`the ${selected.length} selected recording${selected.length === 1 ? "" : "s"}`}
                onConfirm={() => removeSessions([...selected])}
              />
            )}
          </div>
        </section>
      )}

      {phase === "mapping" && <p className="muted">Reading today's sessions and drafting the Work Map… (up to a minute)</p>}

      {(phase === "ready" || phase === "debrief" || phase === "confirming") && map && (
        <section className="ws-run">
          <div className="ws-status">
            <span>
              Draft: <b>{map.workflow}</b> · {map.steps.length} steps · {map.guardrails.length} guardrails
            </span>
            {phase === "debrief" && (
              <span style={{ color: secs >= WRAP_AT_S ? "#b91c1c" : undefined }}>
                {formatMs(secs * 1000)} / {formatMs(LIMIT_S * 1000)}
              </span>
            )}
          </div>
          {gaps.length > 0 && (
            <>
              <h3 className="eyebrow">What {AGENT_NAME} will ask</h3>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ol>
            </>
          )}
          <div className="ws-actions">
            {phase === "ready" && (
              <button type="button" className="ws-primary" onClick={startDebrief}>
                Start 5-minute debrief
              </button>
            )}
            {phase === "debrief" && (
              <button type="button" className="ws-primary" onClick={confirm}>
                Confirm Work Map
              </button>
            )}
            {phase === "confirming" && <span className="muted">Saving the confirmed Work Map…</span>}
          </div>
        </section>
      )}

      {phase === "done" && map && (
        <section className="ws-saved">
          <b>Confirmed: {map.workflow}</b>
          <span className="muted">
            {map.steps.length} steps and {map.guardrails.length} guardrails, now available to learners.
            {gaps.length ? ` Still open: ${gaps.length}.` : ""}
          </span>
          <div className="ws-actions">
            <a className="ws-primary" style={{ textAlign: "center", borderRadius: 8, padding: "10px 14px", textDecoration: "none" }} href={`#/map/${map.id}`}>
              Open the Work Map
            </a>
          </div>
        </section>
      )}

      {error && <p className="error small">{error}</p>}

      {lines.length > 0 && (
        <section className="ws-feed">
          <h3 className="eyebrow">Conversation</h3>
          <ul className="log">
            {lines.slice(-14).map((l, i) => (
              <li key={i}>
                <span className="t">{formatMs(l.t)}</span> <b>{l.speaker === "agent" ? AGENT_NAME : "You"}</b> {l.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function DebriefModule() {
  return (
    <ConversationProvider>
      <Debrief />
    </ConversationProvider>
  );
}
