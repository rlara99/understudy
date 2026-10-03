// Owner: Renzo. Voice side panel for the expert (Interviewer agent).
// Open the ERP in another tab; its events arrive here over BroadcastChannel.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { PauseDetector } from "../agents/pauseRule";
import { formatMs, onErpEvent } from "../shared/bus";
import { putJson } from "../shared/api";
import type { ErpEvent, SessionLog, TranscriptLine } from "../shared/types";

type Mode = "live" | "debrief" | "quick_ask";

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

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      const line: TranscriptLine = {
        t: Date.now() - startRef.current,
        speaker: role === "agent" ? "agent" : "expert",
        text: message,
      };
      setLog((l) => ({ ...l, transcript: [...l.transcript, line] }));
      if (role !== "agent") pause.current.activity();
    },
    onVadScore: ({ vadScore }) => {
      if (vadScore > 0.6) pause.current.activity();
    },
    onError: (message) => console.error("ElevenLabs error:", message),
  });
  const connected = conversation.status === "connected";
  // Effects read the latest hook value through a ref so they don't resubscribe on every render.
  const conv = useRef(conversation);
  conv.current = conversation;

  // ERP events -> agent context (silent) + pause detector
  useEffect(() => {
    return onErpEvent((raw) => {
      const e = { ...raw, t: raw.t - startRef.current };
      if (e.type === "keystroke") {
        pause.current.activity();
        if (connected) conv.current.sendUserActivity();
        return;
      }
      setLog((l) => ({ ...l, events: [...l.events, e] }));
      if (!connected) return;
      conv.current.sendContextualUpdate(`[SCREEN] ${formatMs(e.t)} ${describe(e)}`);
      if (e.type === "field_change") pause.current.decision(describe(e));
    });
  }, [connected]);

  // Pause check: nudge one question when the expert pauses after a decision
  useEffect(() => {
    if (!connected || mode !== "live") return;
    const id = setInterval(() => {
      const decision = pause.current.check(conv.current.isSpeaking);
      if (!decision) return;
      pause.current.markAsked();
      conv.current.sendUserMessage(`[PAUSE] Ask one question about: ${decision}`);
    }, 500);
    return () => clearInterval(id);
  }, [connected, mode]);

  const start = () => {
    startRef.current = Date.now();
    conversation.startSession({
      agentId: import.meta.env.VITE_INTERVIEWER_AGENT_ID,
      connectionType: "webrtc",
      dynamicVariables: { mode, expert_name: "Sabrina" },
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
        Status: {conversation.status} · {conversation.isSpeaking ? "agent speaking" : "listening"} · questions asked:{" "}
        {pause.current.asked}
      </p>
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
