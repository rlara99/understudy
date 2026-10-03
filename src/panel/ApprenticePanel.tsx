// Owner: Renzo. Voice side panel for the expert (Interviewer agent).
// Flow: Start capture (share screen + live questions) -> Finish task (draft Work Map + gaps)
//       -> Start debrief (gaps, then teach-back) -> Confirm Work Map.
// Open the ERP in another tab; its events arrive here over BroadcastChannel.
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { IMPORTANT_FIELDS, PauseDetector } from "../agents/pauseRule";
import {
  AGENT_NAME,
  DEBRIEF_FIRST_MESSAGE,
  INTERVIEWER_FIRST_MESSAGE,
  INTERVIEWER_PROMPT,
  QUICK_ASK_FIRST_MESSAGE,
} from "../agents/prompts";
import { useScreenRecorder } from "../capture/useScreenRecorder";
import { takePendingQuickAsk, type PendingQuickAsk } from "../screens/quickAsk";
import { postJson, putJson } from "../shared/api";
import { formatMs, onErpEvent } from "../shared/bus";
import type { ErpEvent, SessionLog, TranscriptLine, WorkMap } from "../shared/types";

type Phase = "capture" | "mapping" | "ready" | "debrief" | "confirming" | "done" | "quickask" | "patching" | "qadone";

const WORKFLOW = { workflow: "Supplier invoice processing", expert: "Sabrina M.", team: "Accounts payable" };

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

/** The parts of the Work Map the agent needs for the teach-back. */
function mapForAgent(map: WorkMap): string {
  return JSON.stringify({
    steps: map.steps.map((s) => ({ title: s.title, decision: s.decision, reason: s.reason, guardrails: s.guardrails })),
    guardrails: map.guardrails.map((g) => ({ id: g.id, text: g.text })),
  });
}

function Panel() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [log, setLog] = useState<SessionLog>(() => ({
    id: `session-${Date.now()}`,
    mode: "capture",
    started_at: new Date().toISOString(),
    expert: WORKFLOW.expert,
    events: [],
    transcript: [],
  }));
  const [map, setMap] = useState<WorkMap | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  /** Off by default: the mic is muted while the agent talks, so background noise can't cut it off. */
  const [allowInterrupt, setAllowInterrupt] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [debriefSecs, setDebriefSecs] = useState(0);
  const [quickAsk, setQuickAsk] = useState<PendingQuickAsk | null>(null);
  const quickAskRef = useRef(quickAsk);
  quickAskRef.current = quickAsk;
  /** Transcript length when the Quick Ask started; the expert's lines after it are the answer. */
  const quickAskFrom = useRef(0);

  // Opened from the Expert Minute inbox: pick up the handed-over question.
  useEffect(() => {
    const qa = takePendingQuickAsk();
    if (!qa) return;
    setQuickAsk(qa);
    setPhase("quickask");
  }, []);

  const screen = useScreenRecorder();
  const startRef = useRef(Date.now());
  const pause = useRef(new PauseDetector());
  const lastAgentSpeech = useRef(0);
  const debriefStartedAt = useRef<number | null>(null);
  /** 0 = waiting for greeting, 1 = greeting playing, 2 = gaps sent. */
  const debriefStage = useRef(0);
  // Refs so callbacks always see the latest values.
  const logRef = useRef(log);
  logRef.current = log;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const gapsRef = useRef(gaps);
  gapsRef.current = gaps;
  const mapRef = useRef(map);
  mapRef.current = map;

  const note = (text: string) =>
    setDebug((d) => [...d.slice(-40), `${formatMs(Date.now() - startRef.current)} ${text}`]);

  /** Send the draft map and the gaps; the agent starts asking. */
  const sendGaps = () => {
    if (debriefStage.current === 2 || !mapRef.current) return;
    debriefStage.current = 2;
    conv.current.sendContextualUpdate(`[WORKMAP] ${mapForAgent(mapRef.current)}`);
    const list = gapsRef.current.map((g, i) => `${i + 1}. ${g}`).join("\n");
    conv.current.sendUserMessage(
      `[GAPS]\n${list || "No open gaps. Go straight to the teach-back."}\nAsk about these one at a time, then explain the whole process back.`,
    );
    note("debrief: gaps sent");
  };

  /** Quick Ask: hand the agent the question once the greeting is done. */
  const sendQuestion = () => {
    const qa = quickAskRef.current;
    if (debriefStage.current === 2 || !qa) return;
    debriefStage.current = 2;
    conv.current.sendUserMessage(`[QUESTION] ${qa.question}${qa.context ? ` (Case: ${qa.context})` : ""}`);
    note("quick ask: question sent");
  };
  const prime = () => (phaseRef.current === "quickask" ? sendQuestion() : sendGaps());
  const priming = () => phaseRef.current === "debrief" || phaseRef.current === "quickask";

  const conversation = useConversation({
    micMuted: !allowInterrupt && agentSpeaking,
    onAgentToolRequest: (props) => note(`agent tool call: ${JSON.stringify(props).slice(0, 160)}`),
    onInterruption: () => note("agent was interrupted (mic picked up sound)"),
    onModeChange: ({ mode }) => {
      if (mode === "speaking") lastAgentSpeech.current = Date.now();
      setAgentSpeaking(mode === "speaking");
      note(`agent ${mode}`);
      // Debrief / Quick Ask: send the gaps or the question once the greeting has finished.
      if (priming()) {
        if (mode === "speaking" && debriefStage.current === 0) debriefStage.current = 1;
        else if (mode === "listening" && debriefStage.current === 1) prime();
      }
    },
    onConnect: () => {
      if (!priming()) return;
      // Fallback in case the greeting events don't arrive.
      setTimeout(() => {
        if (priming() && !conv.current.isSpeaking) prime();
      }, 8000);
    },
    onDisconnect: (details) => note(`disconnected: ${JSON.stringify(details).slice(0, 160)}`),
    onMessage: ({ message, role }) => {
      const line: TranscriptLine = {
        t: Date.now() - startRef.current,
        speaker: role === "agent" ? "agent" : "expert",
        text: message,
      };
      setLog((l) => ({ ...l, transcript: [...l.transcript, line] }));
      // Quick Ask: the agent confirms with "that's saved" once the expert agreed.
      if (role === "agent" && phaseRef.current === "quickask" && /that.?s saved/i.test(message)) {
        setTimeout(() => saveQuickAsk(), 1500);
      }
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

  // Changes per invoice that the agent hasn't asked about yet, and a queued "task done" nudge.
  const changesByInvoice = useRef(new Map<string, string[]>());
  const currentInvoice = useRef<string | null>(null);
  const pendingTaskDone = useRef<string | null>(null);

  /** The expert finished an invoice: hand its changes to the agent, which decides ask vs. acknowledge. */
  const taskDone = (invoice: string) => {
    const changes = changesByInvoice.current.get(invoice) ?? [];
    changesByInvoice.current.delete(invoice);
    pause.current.forget(invoice);
    if (changes.length === 0) return;
    pendingTaskDone.current = `[TASK DONE] The expert finished ${invoice}. Changes they made: ${changes.join("; ")}.`;
  };

  // ERP events -> agent context (silent) + task tracking
  useEffect(() => {
    const record = (e: ErpEvent) => {
      setLog((l) => ({ ...l, events: [...l.events, e] }));
      if (!connected || phaseRef.current !== "capture") return;
      conv.current.sendContextualUpdate(`[SCREEN] ${formatMs(e.t)} ${describe(e)}`);
      if (e.type === "field_change") {
        const list = changesByInvoice.current.get(e.invoice) ?? [];
        changesByInvoice.current.set(e.invoice, [...list, describe(e)]);
        pause.current.decision(describe(e), IMPORTANT_FIELDS.has(String(e.field)));
      } else if (e.type === "save") {
        taskDone(e.invoice);
      } else if (e.type === "invoice_opened") {
        // Moving to another invoice also counts as finishing the previous one.
        if (currentInvoice.current && currentInvoice.current !== e.invoice) taskDone(currentInvoice.current);
        currentInvoice.current = e.invoice;
      }
    };
    // Merge rapid field_change events per field into one change (safety net; the ERP sends on blur).
    const pending = new Map<string, { event: ErpEvent; timer: ReturnType<typeof setTimeout> }>();
    const flush = () => {
      pending.forEach((p, key) => {
        clearTimeout(p.timer);
        pending.delete(key);
        if (p.event.from !== p.event.to) record(p.event);
      });
    };
    const unsubscribe = onErpEvent((raw) => {
      const e = { ...raw, t: raw.t - startRef.current };
      if (e.type === "keystroke") {
        pause.current.activity();
        // No sendUserActivity here: it holds the agent for ~2 s and swallowed our nudges.
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
        }, 150);
        pending.set(key, { event, timer });
        return;
      }
      flush(); // a save right after an edit must see that edit first
      record(e);
    });
    return () => {
      pending.forEach((p) => clearTimeout(p.timer));
      unsubscribe();
    };
  }, [connected]);

  /** Send a nudge; if the agent stays silent for 5 s, resend once. */
  const sendNudge = (nudge: string, label: string, resend: boolean) => {
    const sentAt = Date.now();
    conv.current.sendUserMessage(nudge);
    note(label);
    if (!resend) return;
    setTimeout(() => {
      if (lastAgentSpeech.current >= sentAt || conv.current.status !== "connected") return;
      conv.current.sendUserMessage(nudge);
      note("no answer after 5 s: resent once");
    }, 5000);
  };

  // Every 300 ms: a finished task goes first; otherwise a mid-task question after a real pause.
  useEffect(() => {
    if (!connected || phase !== "capture") return;
    const id = setInterval(() => {
      if (conv.current.isSpeaking) return;
      if (pendingTaskDone.current) {
        const nudge = pendingTaskDone.current;
        pendingTaskDone.current = null;
        pause.current.countAsked();
        sendNudge(nudge, `task done nudge: ${nudge.slice(12, 120)}`, true);
        return;
      }
      const decision = pause.current.check(false);
      if (!decision) return;
      pause.current.markAsked(decision);
      // Don't repeat this one when the task is done.
      changesByInvoice.current.forEach((list, inv) =>
        changesByInvoice.current.set(inv, list.filter((c) => c !== decision)),
      );
      sendNudge(`[PAUSE] The expert paused mid-task after: ${decision}`, `pause nudge: ${decision}`, false);
    }, 300);
    return () => clearInterval(id);
  }, [connected, phase]);

  const startAgent = (mode: "live" | "debrief" | "quick_ask") =>
    conversation.startSession({
      agentId: import.meta.env.VITE_INTERVIEWER_AGENT_ID,
      connectionType: "webrtc",
      dynamicVariables: {
        mode,
        // A Quick Ask goes to whichever expert the question was routed to.
        expert_name: mode === "quick_ask" ? (quickAskRef.current?.expert ?? "Sabrina").split(" ")[0] : "Sabrina",
        agent_name: AGENT_NAME,
      },
      inputDeviceId: micId || undefined,
      // Prompts come from src/agents/prompts.ts (overrides are enabled in the agent's Security tab).
      overrides: {
        agent: {
          prompt: { prompt: INTERVIEWER_PROMPT },
          firstMessage:
            mode === "debrief" ? DEBRIEF_FIRST_MESSAGE : mode === "quick_ask" ? QUICK_ASK_FIRST_MESSAGE : INTERVIEWER_FIRST_MESSAGE,
        },
      },
    });

  /** Share the screen (first time only), then start the live interviewer. */
  const startCapture = async () => {
    setError(null);
    const fresh = logRef.current.events.length === 0 && logRef.current.transcript.length === 0;
    if (fresh && !screen.recording) {
      // The recording's start time is the session zero point, so event times match the video.
      const t0 = await screen.start(logRef.current.id);
      if (t0 === null) {
        note("screen share cancelled: continuing without a recording");
        startRef.current = Date.now();
      } else {
        startRef.current = t0;
      }
    }
    startAgent("live");
  };

  const saveSession = () => putJson(`/api/sessions/${logRef.current.id}`, logRef.current);

  /** End the live session, store the recording, and build the draft Work Map. */
  const finishTask = async () => {
    setError(null);
    setPhase("mapping");
    if (connected) conversation.endSession();
    await screen.stop();
    try {
      await saveSession();
      const r = await postJson<{ map: WorkMap; gaps: string[] }>("/api/map", {
        sessionId: logRef.current.id,
        ...WORKFLOW,
      });
      setMap(r.map);
      setGaps(r.gaps);
      setPhase("ready");
    } catch (e) {
      setError(`Could not build the Work Map: ${String(e)}`);
      setPhase("capture");
    }
  };

  // Microphones. Labels only appear after mic permission, so "Find microphones" asks once.
  const loadMics = async (ask: boolean) => {
    try {
      if (ask) (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      setMics(inputs);
    } catch (e) {
      setError(`Could not list microphones: ${String(e)}`);
    }
  };
  useEffect(() => {
    loadMics(false);
  }, []);
  const chooseMic = (id: string) => {
    setMicId(id);
    if (connected) conv.current.changeInputDevice({ inputDeviceId: id }).catch((e) => note(`mic switch failed: ${e}`));
  };

  // Debrief clock: capped at 3:30. Nudge the agent to wrap up at 2:30 and to finish at 3:15.
  useEffect(() => {
    if (phase !== "debrief" || !connected) return;
    const t0 = Date.now();
    let wrapSent = false;
    let endSent = false;
    const id = setInterval(() => {
      const secs = Math.floor((Date.now() - t0) / 1000);
      setDebriefSecs(secs);
      if (secs >= 150 && !wrapSent) {
        wrapSent = true;
        conv.current.sendUserMessage("[WRAP UP] One minute left. Skip any remaining questions. Do the teach-back now, under 30 seconds.");
        note("debrief: wrap-up sent at 2:30");
      }
      if (secs >= 195 && !endSent) {
        endSent = true;
        conv.current.sendUserMessage("[TIME UP] Finish in one sentence and ask the expert to press Confirm.");
        note("debrief: time-up sent at 3:15");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, connected]);

  const startDebrief = () => {
    setDebriefSecs(0);
    debriefStage.current = 0;
    debriefStartedAt.current = Date.now() - startRef.current;
    note("debrief started");
    setPhase("debrief");
    phaseRef.current = "debrief";
    startAgent("debrief");
  };

  /** Fold the debrief answers into the map and mark it confirmed. */
  const confirmMap = async () => {
    setError(null);
    setPhase("confirming");
    if (connected) conversation.endSession();
    try {
      await saveSession();
      const r = await postJson<{ map: WorkMap; gaps: string[] }>("/api/map", {
        sessionId: logRef.current.id,
        ...WORKFLOW,
        confirm: true,
        debriefStartedAt: debriefStartedAt.current ?? 0,
      });
      setMap(r.map);
      setGaps(r.gaps);
      setPhase("done");
    } catch (e) {
      setError(`Could not confirm the Work Map: ${String(e)}`);
      setPhase("debrief");
    }
  };

  const startQuickAsk = () => {
    setError(null);
    debriefStage.current = 0;
    quickAskFrom.current = logRef.current.transcript.length;
    startRef.current = Date.now();
    startAgent("quick_ask");
  };

  /** Turn the expert's spoken answer into a Work Map patch (new step + guardrails), clearing the question. */
  const saveQuickAsk = async () => {
    const qa = quickAskRef.current;
    if (!qa || phaseRef.current !== "quickask") return;
    const answer = logRef.current.transcript
      .slice(quickAskFrom.current)
      .filter((l) => l.speaker === "expert")
      .map((l) => l.text)
      .join(" ")
      .trim();
    if (!answer) {
      setError("No spoken answer captured yet. Answer the question, then press Save answer.");
      return;
    }
    setPhase("patching");
    phaseRef.current = "patching";
    if (conv.current.status === "connected") conv.current.endSession();
    try {
      await postJson<WorkMap>("/api/patch", {
        workmapId: qa.workmapId,
        questionId: qa.questionId,
        answer,
        expert: qa.expert ?? WORKFLOW.expert,
      });
      setPhase("qadone");
    } catch (e) {
      setError(`Could not save the answer: ${String(e)}`);
      setPhase("quickask");
    }
  };

  const busy = phase === "mapping" || phase === "confirming" || phase === "patching";

  return (
    <div className="panel">
      <h2>Apprentice</h2>
      <div className="row">
        <label htmlFor="mic">Microphone</label>
        <select id="mic" value={micId} onChange={(e) => chooseMic(e.target.value)}>
          <option value="">System default</option>
          {mics.map((m, i) => (
            <option key={m.deviceId || i} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
        {mics.every((m) => !m.label) && (
          <button type="button" onClick={() => loadMics(true)}>
            Find microphones
          </button>
        )}
        <label>
          <input
            id="allow-interrupt"
            type="checkbox"
            checked={allowInterrupt}
            onChange={(e) => setAllowInterrupt(e.target.checked)}
          />{" "}
          Let me interrupt {AGENT_NAME}
        </label>
      </div>
      {(phase === "quickask" || phase === "patching" || phase === "qadone") && quickAsk && (
        <section className="card">
          <b>Expert Minute{quickAsk.expert ? ` · for ${quickAsk.expert}` : ""}</b>
          <span>{quickAsk.question}</span>
          {quickAsk.context && <span className="muted">{quickAsk.context}</span>}
          <div className="row">
            {phase === "quickask" &&
              (connected ? (
                <>
                  <button onClick={saveQuickAsk}>Save answer</button>
                  <button onClick={() => conversation.endSession()}>Stop</button>
                </>
              ) : (
                <button onClick={startQuickAsk}>Start Quick Ask</button>
              ))}
            {phase === "patching" && <span className="muted">Adding the answer to the Work Map…</span>}
            {phase === "qadone" && (
              <>
                <span>Saved. The Work Map now covers this case.</span>
                <a href="#/library">Library</a>
                <a href={`#/map/${quickAsk.workmapId}`}>Work Map</a>
              </>
            )}
          </div>
        </section>
      )}
      {phase === "debrief" && (
        <p className={debriefSecs >= 180 ? "error" : "muted"}>
          Debrief {formatMs(debriefSecs * 1000)} / 03:30
        </p>
      )}
      <div className="row">
        {phase === "capture" &&
          (connected ? (
            <button onClick={() => conversation.endSession()}>Pause</button>
          ) : (
            <button onClick={startCapture}>{log.events.length ? "Resume capture" : "Start capture"}</button>
          ))}
        {phase === "capture" && (
          <button onClick={finishTask} disabled={log.events.length === 0}>
            Finish task
          </button>
        )}
        {phase === "ready" && <button onClick={startDebrief}>Start debrief</button>}
        {phase === "debrief" && <button onClick={confirmMap}>Confirm Work Map</button>}
        {(phase === "done" || phase === "ready") && map && <a href={`#/map/${map.id}`}>Open Work Map</a>}
      </div>
      <p className="muted">
        {phase === "mapping" && "Building the Work Map draft… (up to a minute)"}
        {phase === "confirming" && "Saving the confirmed Work Map… (up to a minute)"}
        {phase === "done" && `Work Map confirmed: ${map?.steps.length ?? 0} steps, ${map?.guardrails.length ?? 0} guardrails.`}
        {!busy && phase !== "done" && (
          <>
            Status: {conversation.status} · {conversation.isSpeaking ? "agent speaking" : "listening"} ·{" "}
            {screen.recording ? "recording screen" : "not recording"} · questions nudged: {pause.current.asked}
          </>
        )}
      </p>
      {(error || screen.error) && <p className="error">{error ?? screen.error}</p>}
      {gaps.length > 0 && (
        <>
          <h3>{phase === "done" ? "Still open" : "Gaps for the debrief"}</h3>
          <ol>
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
        </>
      )}
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
      <details>
        <summary className="muted">Debug</summary>
        <ul className="log">
          {debug.map((d, i) => (
            <li key={i} className="muted">
              {d}
            </li>
          ))}
        </ul>
      </details>
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
