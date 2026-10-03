// Owner: Renzo. Voice side panel for the expert (Interviewer agent).
// Open the ERP in another tab; its events arrive here over BroadcastChannel.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { IMPORTANT_FIELDS, PauseDetector } from "../agents/pauseRule";
import { AGENT_NAME, INTERVIEWER_FIRST_MESSAGE, INTERVIEWER_PROMPT } from "../agents/prompts";
import { formatMs, onErpEvent } from "../shared/bus";
import { putJson } from "../shared/api";
import type { ErpEvent, SessionLog, TranscriptLine } from "../shared/types";

type Mode = "live" | "debrief" | "quick_ask";

/** The agent's name plus common speech-to-text misspellings of it. */
const NAME_RE = new RegExp(`\\b(${AGENT_NAME}|cloudia|klaudia|claudio|clodia)\\b`, "i");

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
    default:
      return `${e.type} on ${e.invoice}`;
  }
}

function Panel() {
  const [mode, setMode] = useState<Mode>("live");
  const [log, setLog] = useState<SessionLog>(() => ({
    id: `session-${Date.now()}`,
    mode: "capture",
    started_at: new Date().toISOString(),
    expert: "Sabrina M.",
    events: [],
    transcript: [],
  }));
  const startRef = useRef(Date.now());
  const pause = useRef(new PauseDetector());
  const [debug, setDebug] = useState<string[]>([]);
  const note = (text: string) =>
    setDebug((d) => [...d.slice(-40), `${formatMs(Date.now() - startRef.current)} ${text}`]);

  const lastAgentSpeech = useRef(0);

  const conversation = useConversation({
    onAgentToolRequest: (props) => note(`agent tool call: ${JSON.stringify(props).slice(0, 160)}`),
    onInterruption: () => note("agent was interrupted (mic picked up sound)"),
    onModeChange: ({ mode }) => {
      if (mode === "speaking") lastAgentSpeech.current = Date.now();
      note(`agent ${mode}`);
    },
    onDisconnect: (details) => note(`disconnected: ${JSON.stringify(details).slice(0, 160)}`),
    onMessage: ({ message, role }) => {
      const line: TranscriptLine = {
        t: Date.now() - startRef.current,
        speaker: role === "agent" ? "agent" : "expert",
        text: message,
      };
      setLog((l) => ({ ...l, transcript: [...l.transcript, line] }));
      if (role === "agent") return;
      pause.current.activity();
      // The expert called the agent by name. If it hasn't started answering, tell it explicitly.
      if (NAME_RE.test(message)) {
        const heardAt = Date.now();
        note(`name heard: "${message}"`);
        setTimeout(() => {
          if (lastAgentSpeech.current >= heardAt) return;
          conv.current.sendUserMessage(
            `[ADDRESSED] The expert said your name and is talking to you. They said: "${message}". Answer them now, briefly.`,
          );
          note("name nudge sent");
        }, 1200);
      }
    },
    onVadScore: ({ vadScore }) => {
      if (vadScore > 0.6) pause.current.activity();
    },
    onError: (message) => {
      console.error("ElevenLabs error:", message);
      note(`error: ${String(message)}`);
    },
  });
  const connected = conversation.status === "connected";
  // Effects read the latest hook value through a ref so they don't resubscribe on every render.
  const conv = useRef(conversation);
  conv.current = conversation;

  // ERP events -> agent context (silent) + pause detector
  useEffect(() => {
    const record = (e: ErpEvent) => {
      setLog((l) => ({ ...l, events: [...l.events, e] }));
      if (!connected) return;
      conv.current.sendContextualUpdate(`[SCREEN] ${formatMs(e.t)} ${describe(e)}`);
      if (e.type === "field_change") pause.current.decision(describe(e), IMPORTANT_FIELDS.has(String(e.field)));
    };
    // The ERP fires field_change on every keystroke. Merge them per field and
    // record one change ("4711" -> "0400") once typing in that field stops.
    const pending = new Map<string, { event: ErpEvent; timer: ReturnType<typeof setTimeout> }>();
    const unsubscribe = onErpEvent((raw) => {
      const e = { ...raw, t: raw.t - startRef.current };
      if (e.type === "keystroke") {
        pause.current.activity();
        if (connected) conv.current.sendUserActivity();
        return;
      }
      if (e.type === "field_change") {
        pause.current.activity();
        const key = `${e.invoice}.${e.field}`;
        const prev = pending.get(key);
        if (prev) clearTimeout(prev.timer);
        const event = prev ? { ...prev.event, to: e.to } : e;
        const timer = setTimeout(() => {
          pending.delete(key);
          if (event.from !== event.to) record(event);
        }, 700);
        pending.set(key, { event, timer });
        return;
      }
      record(e);
    });
    return () => {
      pending.forEach((p) => clearTimeout(p.timer));
      unsubscribe();
    };
  }, [connected]);

  // Pause check: nudge one question when the expert pauses after a decision
  useEffect(() => {
    if (!connected || mode !== "live") return;
    const id = setInterval(() => {
      const decision = pause.current.check(conv.current.isSpeaking);
      if (!decision) return;
      pause.current.markAsked(decision);
      conv.current.sendUserMessage(`[PAUSE] Ask one question about: ${decision}`);
      note(`pause nudge sent: ${decision}`);
    }, 500);
    return () => clearInterval(id);
  }, [connected, mode]);

  const start = () => {
    startRef.current = Date.now();
    conversation.startSession({
      agentId: import.meta.env.VITE_INTERVIEWER_AGENT_ID,
      connectionType: "webrtc",
      dynamicVariables: { mode, expert_name: "Sabrina", agent_name: AGENT_NAME },
      // Prompts come from src/agents/prompts.ts (needs overrides enabled in the agent's Security tab).
      overrides: { agent: { prompt: { prompt: INTERVIEWER_PROMPT }, firstMessage: INTERVIEWER_FIRST_MESSAGE } },
    });
  };

  const save = () => putJson(`/api/sessions/${log.id}`, log);

  return (
    <div className="panel">
      <h2>Apprentice</h2>
      <div className="row">
        <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={connected}>
          <option value="live">Live capture</option>
          <option value="debrief">Debrief</option>
          <option value="quick_ask">Quick Ask</option>
        </select>
        {connected ? (
          <button onClick={() => conversation.endSession()}>Stop</button>
        ) : (
          <button onClick={start}>Start</button>
        )}
        <button onClick={save}>Save session</button>
      </div>
      <p className="muted">
        Status: {conversation.status} · {conversation.isSpeaking ? "agent speaking" : "listening"} · pause nudges
        sent: {pause.current.asked}
      </p>
      <h3>Debug</h3>
      <ul className="log">
        {debug.map((d, i) => (
          <li key={i} className="muted">
            {d}
          </li>
        ))}
      </ul>
      <h3>Transcript</h3>
      <ul className="log">
        {log.transcript.map((l, i) => (
          <li key={i}>
            <span className="t">{formatMs(l.t)}</span> <b>{l.speaker}</b> {l.text}
          </li>
        ))}
      </ul>
      <h3>Screen events</h3>
      <ul className="log">
        {log.events.map((e, i) => (
          <li key={i}>
            <span className="t">{formatMs(e.t)}</span> {describe(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApprenticePanel() {
  return (
    <ConversationProvider>
      <Panel />
    </ConversationProvider>
  );
}
