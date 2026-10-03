// Owner: Renzo. Expert · Work mode. Runs in the companion window (desktop) or a tab (browser).
//   mode "live":   Claudia watches and asks at the right moments (ERP events + screen vision for any app).
//   mode "record": record and learn. Screen + mic (+ opt-in call audio) are recorded and transcribed. No questions.
// Both: Off the record (button, ERP button, or saying it in live mode). Finish saves the session for
// "Debrief and teach" later in the day.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { IMPORTANT_FIELDS, PauseDetector } from "../agents/pauseRule";
import { AGENT_NAME, INTERVIEWER_FIRST_MESSAGE, INTERVIEWER_PROMPT } from "../agents/prompts";
import { useScreenRecorder } from "../capture/useScreenRecorder";
import { postJson, putJson } from "../shared/api";
import { formatMs, onErpEvent } from "../shared/bus";
import { closeSession } from "../shared/desktop";
import type { ErpEvent, SessionLog, TranscriptLine } from "../shared/types";
import { useAudioTranscriber } from "./useAudioTranscriber";
import { useMicHold } from "./useMicHold";
import "./session.css";

type Mode = "live" | "record";
type Phase = "setup" | "running" | "saving" | "saved";

interface FrameResult {
  app: string;
  changes: string[];
  task_done: string | null;
  judgment_call: string | null;
}

const EXPERT = "Sabrina M.";
const NAME_RE = new RegExp(`\\b(${AGENT_NAME}|cloudia|klaudia|claudio|clodia)\\b`, "i");
/** While the ERP sends exact events, skip vision (cheaper, and no double questions). */
const ERP_QUIET_MS = 10_000;

function describe(e: ErpEvent): string {
  switch (e.type) {
    case "invoice_opened":
      return `invoice ${e.invoice} opened`;
    case "field_change":
      return `${e.field} changed from "${e.from ?? ""}" to "${e.to ?? ""}" on ${e.invoice}`;
    case "save":
      return `${e.invoice} saved`;
    case "guardrail_blocked":
      return `save of ${e.invoice} blocked: ${e.note ?? ""}`;
    case "screen":
      return `${e.app ? `${e.app}: ` : ""}${e.note ?? ""}`;
    default:
      return `${e.type} on ${e.invoice}`;
  }
}

function Session({ mode }: { mode: Mode }) {
  const live = mode === "live";
  const [phase, setPhase] = useState<Phase>("setup");
  const [log, setLog] = useState<SessionLog>(() => ({
    id: `session-${Date.now()}`,
    mode,
    started_at: new Date().toISOString(),
    expert: EXPERT,
    events: [],
    transcript: [],
  }));
  const [withCallAudio, setWithCallAudio] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const screen = useScreenRecorder();
  const audio = useAudioTranscriber();
  const mic = useMicHold();
  /** Last nudge, so it can be resent once if noise cuts the answer off. */
  const lastNudge = useRef<{ text: string; at: number; resent: boolean } | null>(null);
  const zero = useRef(Date.now());
  const logRef = useRef(log);
  logRef.current = log;
  const offRef = useRef(screen.offRecord);
  offRef.current = screen.offRecord;
  const pause = useRef(new PauseDetector());
  const lastAgentSpeech = useRef(0);
  const lastErpAt = useRef(0);
  const changesByInvoice = useRef(new Map<string, string[]>());
  const currentInvoice = useRef<string | null>(null);
  const pendingTaskDone = useRef<string | null>(null);

  const note = (text: string) => setDebug((d) => [...d.slice(-40), `${formatMs(Date.now() - zero.current)} ${text}`]);
  const addEvent = (e: ErpEvent) => setLog((l) => ({ ...l, events: [...l.events, e] }));

  // ---------- Claudia (live mode only) ----------
  const conversation = useConversation({
    micMuted: screen.offRecord || mic.held, // off the record: she hears nothing; mic closed while she prepares/says a reply
    onModeChange: ({ mode: m }) => {
      if (m === "speaking") lastAgentSpeech.current = Date.now();
      setAgentSpeaking(m === "speaking");
      mic.onMode(m);
    },
    onInterruption: () => {
      note("interrupted by sound");
      const n = lastNudge.current;
      if (n && !n.resent && Date.now() - n.at < 20_000) {
        n.resent = true;
        setTimeout(() => {
          if (conv.current.status !== "connected" || offRef.current) return;
          mic.hold(8000);
          conv.current.sendUserMessage(n.text);
          note("question resent after interruption");
        }, 800);
      }
    },
    onDisconnect: (d) => note(`disconnected: ${JSON.stringify(d).slice(0, 100)}`),
    onError: (m) => note(`error: ${String(m)}`),
    onMessage: ({ message, role }) => {
      if (offRef.current) return;
      if (role === "agent") {
        if (/\?\s*$/.test(message)) setLastQuestion(message);
      } else {
        if (/\boff the record\b/i.test(message) && !/\bback on\b/i.test(message)) {
          screen.setOffRecord(true);
          return;
        }
        pause.current.activity();
        mic.hold(3000); // she may reply: keep noise out until she has
        if (NAME_RE.test(message)) {
          const heardAt = Date.now();
          setTimeout(() => {
            if (lastAgentSpeech.current >= heardAt || conv.current.status !== "connected") return;
            conv.current.sendUserMessage(
              `[ADDRESSED] The expert said your name and is talking to you. They said: "${message}". Answer them now, briefly.`,
            );
          }, 1200);
        }
      }
      const line: TranscriptLine = { t: Date.now() - zero.current, speaker: role === "agent" ? "agent" : "expert", text: message };
      setLog((l) => ({ ...l, transcript: [...l.transcript, line] }));
    },
  });
  const connected = conversation.status === "connected";
  const conv = useRef(conversation);
  conv.current = conversation;

  const sendNudge = (nudge: string, resend: boolean) => {
    const sentAt = Date.now();
    mic.hold(8000);
    lastNudge.current = { text: nudge, at: sentAt, resent: false };
    conv.current.sendUserMessage(nudge);
    note(nudge.slice(0, 90));
    if (!resend) return;
    setTimeout(() => {
      if (lastAgentSpeech.current >= sentAt || conv.current.status !== "connected") return;
      mic.hold(8000);
      conv.current.sendUserMessage(nudge);
    }, 5000);
  };

  const taskDone = (invoice: string) => {
    const changes = changesByInvoice.current.get(invoice) ?? [];
    changesByInvoice.current.delete(invoice);
    pause.current.forget(invoice);
    if (changes.length) pendingTaskDone.current = `[TASK DONE] The expert finished ${invoice}. Changes they made: ${changes.join("; ")}.`;
  };

  // ---------- ERP events (separate app, via the relay) ----------
  useEffect(() => {
    if (phase !== "running") return;
    return onErpEvent((raw) => {
      if (offRef.current) return;
      lastErpAt.current = Date.now();
      const e = { ...raw, t: raw.t - zero.current };
      if (e.type === "keystroke") {
        pause.current.activity();
        return;
      }
      addEvent(e);
      if (!live || conv.current.status !== "connected") return;
      conv.current.sendContextualUpdate(`[SCREEN] ${formatMs(e.t)} ${describe(e)}`);
      if (e.type === "field_change") {
        pause.current.activity();
        changesByInvoice.current.set(e.invoice, [...(changesByInvoice.current.get(e.invoice) ?? []), describe(e)]);
        pause.current.decision(describe(e), IMPORTANT_FIELDS.has(String(e.field)));
      } else if (e.type === "save") taskDone(e.invoice);
      else if (e.type === "invoice_opened") {
        if (currentInvoice.current && currentInvoice.current !== e.invoice) taskDone(currentInvoice.current);
        currentInvoice.current = e.invoice;
      }
    });
  }, [phase, live]);

  // ---------- Vision: any app ----------
  useEffect(() => {
    if (phase !== "running" || !screen.recording) return;
    let busy = false;
    let lastFrame = "";
    let previous: string | undefined;
    const id = setInterval(async () => {
      if (busy || offRef.current || Date.now() - lastErpAt.current < ERP_QUIET_MS) return;
      const frame = screen.grabFrame(1024);
      if (!frame || frame === lastFrame) return;
      lastFrame = frame;
      busy = true;
      try {
        const r = await postJson<FrameResult>("/api/frame", { image: frame, previous });
        if (offRef.current) return;
        const what = [...r.changes, r.task_done ? `finished: ${r.task_done}` : ""].filter(Boolean).join("; ");
        if (!what) return;
        previous = `${r.app}: ${what}`;
        const e: ErpEvent = { t: Date.now() - zero.current, type: "screen", invoice: "", app: r.app, note: what };
        addEvent(e);
        if (!live || conv.current.status !== "connected") return;
        conv.current.sendContextualUpdate(`[SCREEN] ${formatMs(e.t)} ${previous}`);
        if (r.judgment_call) pause.current.decision(r.judgment_call, true);
        if (r.task_done)
          pendingTaskDone.current = `[TASK DONE] The expert finished: ${r.task_done}.${r.judgment_call ? ` Looks like a judgment call: ${r.judgment_call}.` : ""}`;
      } catch (err) {
        note(`vision: ${String(err).slice(0, 80)}`);
      } finally {
        busy = false;
      }
    }, live ? 3000 : 6000);
    return () => clearInterval(id);
  }, [phase, screen.recording, live]);

  // ---------- When to ask (live) ----------
  useEffect(() => {
    if (!live || !connected || phase !== "running") return;
    const id = setInterval(() => {
      if (conv.current.isSpeaking || offRef.current) return;
      if (pendingTaskDone.current) {
        const nudge = pendingTaskDone.current;
        pendingTaskDone.current = null;
        pause.current.countAsked();
        sendNudge(nudge, true);
        return;
      }
      const decision = pause.current.check(false);
      if (!decision) return;
      pause.current.markAsked(decision);
      changesByInvoice.current.forEach((list, inv) => changesByInvoice.current.set(inv, list.filter((c) => c !== decision)));
      sendNudge(`[PAUSE] The expert paused mid-task after: ${decision}`, false);
    }, 300);
    return () => clearInterval(id);
  }, [live, connected, phase]);

  // ---------- Off the record ----------
  const wasOff = useRef(false);
  useEffect(() => {
    if (screen.offRecord === wasOff.current) return;
    wasOff.current = screen.offRecord;
    if (!live) {
      if (screen.offRecord) audio.pause();
      else audio.resume();
    } else if (conv.current.status === "connected") {
      pendingTaskDone.current = null;
      conv.current.sendContextualUpdate(
        screen.offRecord
          ? "[OFF RECORD] The expert went off the record. Don't ask about or mention anything until [ON RECORD]."
          : "[ON RECORD] The expert is back on the record.",
      );
    }
    note(screen.offRecord ? "off the record" : "back on the record");
  }, [screen.offRecord]);

  // ---------- Clock + mics ----------
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setElapsed(Date.now() - zero.current), 1000);
    return () => clearInterval(id);
  }, [phase]);
  const loadMics = async (ask: boolean) => {
    try {
      if (ask) (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
      setMics((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
    } catch (e) {
      setError(`Could not list microphones: ${String(e)}`);
    }
  };
  useEffect(() => {
    loadMics(false);
  }, []);

  // ---------- Start / finish ----------
  const start = async () => {
    setError(null);
    const t0 = await screen.start(logRef.current.id);
    zero.current = t0 ?? Date.now();
    if (t0 === null) note("screen not shared: continuing without a recording");
    setLog((l) => ({ ...l, started_at: new Date(zero.current).toISOString() }));
    setPhase("running");
    if (live) {
      conversation.startSession({
        agentId: import.meta.env.VITE_INTERVIEWER_AGENT_ID,
        connectionType: "webrtc",
        inputDeviceId: micId || undefined,
        dynamicVariables: { mode: "live", expert_name: EXPERT.split(" ")[0], agent_name: AGENT_NAME },
        overrides: { agent: { prompt: { prompt: INTERVIEWER_PROMPT }, firstMessage: INTERVIEWER_FIRST_MESSAGE } },
      });
    } else {
      try {
        await audio.start({ zero: zero.current, micId: micId || undefined, withCallAudio });
      } catch (e) {
        setError(`Could not start the microphone: ${String(e)}`);
      }
    }
  };

  const finish = async () => {
    setPhase("saving");
    if (connected) conversation.endSession();
    const transcript = live ? logRef.current.transcript : await audio.stop();
    const spans = screen.offRecordSpans();
    await screen.stop();
    const l = logRef.current;
    const apps = [...new Set(l.events.map((e) => (e.type === "screen" ? e.app : "ERP")).filter(Boolean))];
    const tasks = l.events.filter((e) => e.type === "save" || (e.type === "screen" && e.note?.includes("finished:"))).length;
    try {
      await putJson(`/api/sessions/${l.id}`, {
        ...l,
        transcript,
        ended_at: new Date().toISOString(),
        off_record: spans,
        title: `${live ? "Live" : "Record & learn"} · ${apps.join(", ") || "screen"}${tasks ? ` · ${tasks} task${tasks > 1 ? "s" : ""}` : ""}`,
      } satisfies SessionLog);
      setPhase("saved");
    } catch (e) {
      setError(`Could not save the session: ${String(e)}`);
      setPhase("running");
    }
  };

  const transcript = live ? log.transcript : audio.lines;

  return (
    <div className="ws">
      <header className="ws-head">
        <span className={`ws-dot ${phase === "running" ? (screen.offRecord ? "off" : "rec") : ""}`} aria-hidden="true" />
        <div>
          <b>{live ? `Live with ${AGENT_NAME}` : "Record & learn"}</b>
          <span className="muted small">
            {live ? `${AGENT_NAME} asks when something interesting happens` : "Records and transcribes. No questions."}
          </span>
        </div>
        {phase === "running" && <span className="ws-clock">{formatMs(elapsed)}</span>}
      </header>

      {phase === "setup" && (
        <section className="ws-setup">
          <label htmlFor="ws-mic">Microphone</label>
          <div className="row">
            <select id="ws-mic" value={micId} onChange={(e) => setMicId(e.target.value)}>
              <option value="">System default</option>
              {mics.map((m, i) => (
                <option key={m.deviceId || i} value={m.deviceId}>
                  {m.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            {mics.every((m) => !m.label) && (
              <button type="button" className="quiet" onClick={() => loadMics(true)}>
                Find
              </button>
            )}
          </div>
          {!live && (
            <label className="ws-check">
              <input id="ws-call" type="checkbox" checked={withCallAudio} onChange={(e) => setWithCallAudio(e.target.checked)} />
              <span>
                <b>Also listen to call audio</b>
                <span className="muted small">Transcribes the other people on a Teams or Zoom call. Tell them first.</span>
              </span>
            </label>
          )}
          <button type="button" className="ws-primary" onClick={start}>
            {live ? `Start working with ${AGENT_NAME}` : "Start recording"}
          </button>
          <p className="muted small">Your screen is recorded. Personal fields stay blurred. Go off the record any time.</p>
        </section>
      )}

      {phase === "running" && (
        <section className="ws-run">
          <div className="ws-status">
            <span>{screen.recording ? "Recording screen" : "Not recording screen"}</span>
            {live && <span>{connected ? (agentSpeaking ? `${AGENT_NAME} is speaking` : `${AGENT_NAME} is listening`) : "Connecting…"}</span>}
            {!live && <span>{audio.callAudio ? "Mic + call audio" : "Mic"}{audio.transcribing ? " · transcribing…" : ""}</span>}
          </div>
          {live && lastQuestion && !screen.offRecord && <blockquote className="ws-question">{lastQuestion}</blockquote>}
          {screen.offRecord && (
            <p className="ws-off">Off the record. Nothing is recorded, heard or logged. Press “Back on the record” to resume.</p>
          )}
          <div className="ws-actions">
            <button type="button" className={screen.offRecord ? "ws-primary" : ""} onClick={() => screen.setOffRecord(!screen.offRecord)}>
              {screen.offRecord ? "Back on the record" : "Off the record"}
            </button>
            <button type="button" onClick={finish}>
              Finish
            </button>
          </div>
        </section>
      )}

      {phase === "saving" && <p className="muted">{live ? "Saving the session…" : "Finishing the transcript…"}</p>}

      {phase === "saved" && (
        <section className="ws-saved">
          <b>Saved.</b>
          <span className="muted">
            {log.events.length} screen events{transcript.length ? `, ${transcript.length} transcript lines` : ""}. Review it later in
            Debrief &amp; teach.
          </span>
          <div className="ws-actions">
            <button type="button" className="ws-primary" onClick={() => closeSession("expert/debrief")}>
              Go to Debrief &amp; teach
            </button>
            <button type="button" onClick={() => location.reload()}>
              New session
            </button>
          </div>
        </section>
      )}

      {(error || screen.error || audio.error) && <p className="error small">{error ?? screen.error ?? audio.error}</p>}

      {transcript.length > 0 && (
        <section className="ws-feed">
          <h3 className="eyebrow">Transcript</h3>
          <ul className="log">
            {transcript.slice(-12).map((l, i) => (
              <li key={i}>
                <span className="t">{formatMs(l.t)}</span> <b>{l.speaker === "agent" ? AGENT_NAME : l.speaker === "other" ? "Call" : "You"}</b>{" "}
                {l.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {log.events.length > 0 && (
        <details className="ws-feed">
          <summary className="muted small">What {AGENT_NAME} saw ({log.events.length})</summary>
          <ul className="log">
            {log.events.slice(-15).map((e, i) => (
              <li key={i} className="small">
                <span className="t">{formatMs(e.t)}</span> {describe(e)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="muted small">Debug</summary>
        <ul className="log">
          {debug.map((d, i) => (
            <li key={i} className="muted small">
              {d}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function WorkSession({ mode }: { mode: Mode }) {
  return (
    <ConversationProvider>
      <Session mode={mode} />
    </ConversationProvider>
  );
}
