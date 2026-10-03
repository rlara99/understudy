// Owner: Renzo. Expert · Debrief & teach. During or at the end of the day:
// pick the recorded sessions (live + record & learn) → draft Work Map + gaps → a 5-minute spoken debrief
// with Claudia (gaps, then a teach-back) → Confirm → the confirmed Work Map feeds the learners.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { AGENT_NAME, DEBRIEF_FIRST_MESSAGE, INTERVIEWER_PROMPT } from "../agents/prompts";
import { getJson, postJson } from "../shared/api";
import { formatMs } from "../shared/bus";
import type { SessionLog, TranscriptLine, WorkMap } from "../shared/types";
import "./session.css";

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
    conv.current.sendUserMessage(
      `[GAPS]\n${list || "No open gaps. Go straight to the teach-back."}\nYou have 5 minutes. Ask about these one at a time, then explain the whole process back.`,
    );
  };

  const conversation = useConversation({
    micMuted: agentSpeaking,
    onModeChange: ({ mode }) => {
      setAgentSpeaking(mode === "speaking");
      if (mode === "speaking" && stage.current === 0) stage.current = 1;
      else if (mode === "listening" && stage.current === 1) sendGaps();
    },
    onConnect: () =>
      setTimeout(() => {
        if (!conv.current.isSpeaking) sendGaps();
      }, 8000),
    onMessage: ({ message, role }) =>
      setLines((l) => [...l, { t: Date.now() - t0.current, speaker: role === "agent" ? "agent" : "expert", text: message }]),
    onError: (m) => setError(String(m)),
  });
  const connected = conversation.status === "connected";
  const conv = useRef(conversation);
  conv.current = conversation;

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
        conv.current.sendUserMessage("[WRAP UP] About a minute left. Skip any remaining questions. Do the teach-back now, under 30 seconds.");
      }
      if (s >= END_AT_S && !end) {
        end = true;
        conv.current.sendUserMessage("[TIME UP] Finish in one sentence and ask the expert to press Confirm.");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, connected]);

  const prepare = async () => {
    setError(null);
    setPhase("mapping");
    try {
      const r = await postJson<{ map: WorkMap; gaps: string[] }>("/api/map", { sessionIds: selected, expert: EXPERT, team: TEAM });
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

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const today = (sessions ?? []).filter((s) => isToday(s.started_at));
  const earlier = (sessions ?? []).filter((s) => !isToday(s.started_at)).slice(0, 10);

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
          <h3 className="eyebrow">Today</h3>
          {sessions === null && <p className="muted">Loading sessions…</p>}
          {sessions !== null && today.length === 0 && <p className="muted">No sessions recorded today yet. Start Work mode first.</p>}
          {[...today, ...earlier].map((s, i) => (
            <label key={s.id} className="ws-check" style={i === today.length && i > 0 ? { marginTop: 12 } : undefined}>
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>
                <b>{s.title ?? (s.mode === "record" ? "Record & learn" : "Live session")}</b>
                <span className="muted small">
                  {isToday(s.started_at) ? timeOf(s.started_at) : new Date(s.started_at).toLocaleDateString()} · {s.event_count} events ·{" "}
                  {s.transcript_count} lines{s.reviewed_in ? " · already reviewed" : ""}
                </span>
              </span>
            </label>
          ))}
          <button type="button" className="ws-primary" disabled={selected.length === 0} onClick={prepare}>
            Prepare debrief ({selected.length} session{selected.length === 1 ? "" : "s"})
          </button>
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
