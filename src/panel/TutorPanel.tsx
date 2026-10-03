// Owner: Renzo. Voice tutor for the new hire (Tutor agent). Open next to /#/erp/teach.
// - Loads the newest confirmed Work Map and gives it to the agent.
// - A blocked save (ERP guardrail check) -> the agent asks the new hire to predict, explains
//   with the expert's words, and the expert's clip plays here.
// - A case the map doesn't cover -> flagged as an open question, routed to the right expert (Gap Loop).
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { AGENT_NAME, TUTOR_FIRST_MESSAGE, TUTOR_PROMPT } from "../agents/prompts";
import { ClipPlayer } from "../capture/ClipPlayer";
import { getJson, postJson, putJson } from "../shared/api";
import { formatMs, onErpEvent } from "../shared/bus";
import type { Invoice, OpenQuestion, Step, WorkMap } from "../shared/types";

const EXPERT_FIRST_NAME = "Sabrina";

/** "Sabrina never showed me this" and similar. */
const GAP_RE = /(never|didn'?t|did not|hasn'?t|has not)\s+(show|shown|showed|teach|taught|tell|told|explain|explained)/i;

/** Newest confirmed real map wins; the hand-made sample is the fallback. (Same rule as the ERP.) */
function pickMap(maps: WorkMap[]): WorkMap | null {
  const byDate = [...maps].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return byDate.find((m) => !m.sample && m.confirmed) ?? byDate.find((m) => !m.sample) ?? byDate[0] ?? null;
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);

function describeInvoice(inv: Invoice): string {
  return `${inv.id} from ${inv.supplier} (${inv.country}), ${money(inv.amount, inv.currency)}, "${inv.description}", dated ${inv.date}`;
}

/** What the agent needs from the map: steps with reasons and clip times, guardrails with the expert's words. */
function mapForAgent(map: WorkMap): string {
  return JSON.stringify({
    expert: map.expert,
    steps: map.steps.map((s) => ({
      step_id: s.id,
      title: s.title,
      decision: s.decision,
      reason: s.reason,
      guardrails: s.guardrails,
    })),
    guardrails: map.guardrails.map((g) => ({ id: g.id, rule: g.text, expert_words: g.quote })),
  });
}

function Tutor() {
  const [map, setMap] = useState<WorkMap | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clipStep, setClipStep] = useState<Step | null>(null);
  const [transcript, setTranscript] = useState<{ t: number; who: string; text: string }[]>([]);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [debug, setDebug] = useState<string[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const t0 = useRef(Date.now());
  const mapRef = useRef(map);
  mapRef.current = map;
  const invoicesRef = useRef(invoices);
  invoicesRef.current = invoices;
  const currentInvoice = useRef<string | null>(null);
  const flaggedInvoices = useRef(new Set<string>());

  const note = (text: string) => setDebug((d) => [...d.slice(-40), `${formatMs(Date.now() - t0.current)} ${text}`]);

  useEffect(() => {
    const load = () =>
      getJson<WorkMap[]>("/api/workmaps")
        .then((maps) => setMap(pickMap(maps)))
        .catch(() => {});
    load();
    getJson<Invoice[]>("/api/invoices").then(setInvoices).catch(() => {});
    addEventListener("focus", load);
    return () => removeEventListener("focus", load);
  }, []);

  const stepForGuardrail = (gid: string) => mapRef.current?.steps.find((s) => s.guardrails.includes(gid)) ?? null;

  /** Flag a case the map doesn't cover: route it to an expert and add it to the map's open questions. */
  const flagGap = async (invoiceId: string | null, hint?: string) => {
    const m = mapRef.current;
    const key = invoiceId ?? hint ?? "general";
    if (!m || flaggedInvoices.current.has(key)) return "Already flagged.";
    flaggedInvoices.current.add(key);
    const inv = invoicesRef.current.find((i) => i.id === invoiceId);
    const context = inv ? describeInvoice(inv) : undefined;
    const question = hint ?? (inv ? `How should an invoice like ${describeInvoice(inv)} be handled?` : "A case the Work Map doesn't cover.");
    note(`flagging gap: ${question.slice(0, 80)}`);
    try {
      const latest = await getJson<WorkMap>(`/api/workmaps/${m.id}`);
      const open = latest.open_questions.filter((q) => q.status === "open");
      const routed = await postJson<{
        expert_name: string;
        reason: string;
        neutral_question: string;
        duplicate_of: string | null;
      }>("/api/route", { question, context, open: open.map((q) => ({ id: q.id, q: q.q })) });
      const same = open.find((q) => q.id === routed.duplicate_of);
      if (same) {
        same.asked_by_count += 1;
        note(`merged into an existing question, now asked by ${same.asked_by_count}`);
      }
      else {
        const q: OpenQuestion = {
          id: `q-${Date.now()}`,
          q: routed.neutral_question,
          context,
          asked_by_count: 1,
          route_to: routed.expert_name,
          route_reason: routed.reason,
          status: "open",
        };
        latest.open_questions.push(q);
      }
      setMap(await putJson<WorkMap>(`/api/workmaps/${latest.id}`, latest));
      setFlagged((f) => [...f, `${routed.neutral_question} → ${routed.expert_name}`]);
      note(`flagged for ${routed.expert_name}`);
      return `Flagged for ${routed.expert_name}.`;
    } catch (e) {
      flaggedInvoices.current.delete(key);
      setError(`Could not flag the question: ${String(e)}`);
      return "Could not flag it.";
    }
  };

  const conversation = useConversation({
    micMuted: agentSpeaking, // background noise can't cut the tutor off
    onModeChange: ({ mode }) => {
      setAgentSpeaking(mode === "speaking");
      note(`tutor ${mode}`);
    },
    onConnect: () => {
      const m = mapRef.current;
      if (!m) return;
      setTimeout(() => conv.current.sendContextualUpdate(`[WORKMAP] ${mapForAgent(m)}`), 300);
      note(`work map sent: ${m.workflow}`);
    },
    onDisconnect: (d) => note(`disconnected: ${JSON.stringify(d).slice(0, 120)}`),
    onError: (message) => note(`error: ${String(message)}`),
    onMessage: ({ message, role }) => {
      setTranscript((t) => [...t, { t: Date.now() - t0.current, who: role === "agent" ? "tutor" : "new hire", text: message }]);
      // Backups that don't depend on client tools being set up in the dashboard:
      if (role !== "agent" && GAP_RE.test(message)) flagGap(currentInvoice.current);
      if (role === "agent" && /\bflagged\b/i.test(message)) flagGap(currentInvoice.current);
    },
  });
  const connected = conversation.status === "connected";
  const conv = useRef(conversation);
  conv.current = conversation;

  // ERP (teach tab) events -> tutor
  useEffect(() => {
    let blockedBatch: string[] = [];
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onErpEvent((e) => {
      if (e.type === "keystroke") return;
      const live = conv.current.status === "connected";
      if (e.type === "invoice_opened") {
        currentInvoice.current = e.invoice;
        setClipStep(null);
        const inv = invoicesRef.current.find((i) => i.id === e.invoice);
        if (live && inv) conv.current.sendUserMessage(`[OPENED] ${describeInvoice(inv)}`);
        return;
      }
      if (e.type === "field_change") {
        if (live) conv.current.sendContextualUpdate(`[SCREEN] ${e.field} changed from "${e.from}" to "${e.to}" on ${e.invoice}`);
        return;
      }
      if (e.type === "save") {
        if (live) conv.current.sendUserMessage(`[SAVED] ${e.invoice} saved with status ${e.to}.`);
        return;
      }
      if (e.type === "guardrail_blocked") {
        // The ERP sends one event per broken guardrail; batch them into one message.
        const gid = String(e.field);
        blockedBatch.push(gid);
        const step = stepForGuardrail(gid);
        if (step) setClipStep(step); // show the expert's moment right away
        if (blockedTimer) clearTimeout(blockedTimer);
        blockedTimer = setTimeout(() => {
          const m = mapRef.current;
          const lines = blockedBatch.map((id) => {
            const g = m?.guardrails.find((x) => x.id === id);
            const s = stepForGuardrail(id);
            return `rule "${g?.text ?? id}"${g?.quote ? `, ${EXPERT_FIRST_NAME}'s words: "${g.quote}"` : ""}${s ? `, her reason: "${s.reason}"` : ""}`;
          });
          blockedBatch = [];
          note(`blocked: ${lines.join(" | ").slice(0, 120)}`);
          if (conv.current.status === "connected")
            conv.current.sendUserMessage(
              `[BLOCKED] The new hire tried to save ${e.invoice}, but it breaks ${lines.join("; ")}. ${EXPERT_FIRST_NAME}'s clip is already playing on screen.`,
            );
        }, 250);
      }
    });
    return () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      unsubscribe();
    };
  }, []);

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
  const chooseMic = (id: string) => {
    setMicId(id);
    if (connected) conv.current.changeInputDevice({ inputDeviceId: id }).catch((e) => note(`mic switch failed: ${e}`));
  };

  const start = () => {
    setError(null);
    t0.current = Date.now();
    conversation.startSession({
      agentId: import.meta.env.VITE_TUTOR_AGENT_ID,
      connectionType: "webrtc",
      inputDeviceId: micId || undefined,
      dynamicVariables: { expert_name: EXPERT_FIRST_NAME, agent_name: AGENT_NAME },
      overrides: { agent: { prompt: { prompt: TUTOR_PROMPT }, firstMessage: TUTOR_FIRST_MESSAGE } },
      // Optional: also define these as client tools in the Tutor agent's dashboard to let it call them.
      clientTools: {
        replay_moment: ({ step_id }: { step_id?: string }) => {
          const s = mapRef.current?.steps.find((x) => x.id === step_id) ?? null;
          if (s) setClipStep(s);
          return s ? `Playing ${EXPERT_FIRST_NAME}'s clip for "${s.title}".` : "No clip for that step.";
        },
        flag_open_question: ({ question }: { question?: string }) => flagGap(currentInvoice.current, question),
      },
    });
  };

  if (!import.meta.env.VITE_TUTOR_AGENT_ID)
    return (
      <div className="panel">
        <h2>Tutor</h2>
        <p className="error">Add the Tutor agent ID as VITE_TUTOR_AGENT_ID in .env.development, then restart the app.</p>
      </div>
    );

  return (
    <div className="panel">
      <h2>Tutor</h2>
      <p className="muted">
        {map
          ? `Teaching from: ${map.workflow} (${map.expert}${map.confirmed ? ", confirmed" : ", draft"}${map.sample ? ", sample" : ""})`
          : "No Work Map yet. Record a capture session first."}
      </p>
      <div className="row">
        <label htmlFor="tutor-mic">Microphone</label>
        <select id="tutor-mic" value={micId} onChange={(e) => chooseMic(e.target.value)}>
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
        {connected ? (
          <button onClick={() => conversation.endSession()}>Stop</button>
        ) : (
          <button onClick={start} disabled={!map}>
            Start tutor
          </button>
        )}
      </div>
      <p className="muted">
        Status: {conversation.status} · {agentSpeaking ? "tutor speaking" : "listening"}
      </p>
      {error && <p className="error">{error}</p>}

      {clipStep && map && (
        <section>
          <h3>
            {EXPERT_FIRST_NAME} at {clipStep.moment.t}: {clipStep.title}
          </h3>
          <ClipPlayer key={clipStep.id} at={clipStep.moment.clip_s} sessionId={map.sample ? undefined : map.id} />
          <p>
            <q>{clipStep.reason}</q> <span className="muted">{map.expert}</span>
          </p>
        </section>
      )}

      {flagged.length > 0 && (
        <>
          <h3>Flagged for an expert</h3>
          <ul>
            {flagged.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}

      <h3>Transcript</h3>
      <ul className="log">
        {transcript.map((l, i) => (
          <li key={i}>
            <span className="t">{formatMs(l.t)}</span> <b>{l.who}</b> {l.text}
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

export function TutorPanel() {
  return (
    <ConversationProvider>
      <Tutor />
    </ConversationProvider>
  );
}
