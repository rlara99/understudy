// SHARED FILE: Renzo + Pablo agree before changing anything here, then push right away.

/** Something that happened in the work app (ERP), sent over the relay channel "erp" (src/shared/bus.ts). */
export type ErpEventType =
  | "invoice_opened"
  | "field_change"
  | "keystroke"
  | "save"
  | "guardrail_blocked"
  /** Seen on screen by vision (any app, not just the ERP). `note` says what changed. */
  | "screen";

export interface ErpEvent {
  /** The ERP sends Date.now(); the panel rewrites it to ms since recording start when it logs the event. */
  t: number;
  type: ErpEventType;
  invoice: string;
  field?: keyof Invoice | string;
  from?: string;
  to?: string;
  /** Free text, e.g. the guardrail text on "guardrail_blocked", or what vision saw on "screen". */
  note?: string;
  /** App seen on screen (vision events), e.g. "Excel". */
  app?: string;
}

// Matches data/invoices.json (Pablo's seed data).
export interface Invoice {
  id: string;
  phase: "capture" | "teach";
  supplier: string;
  supplier_known: boolean;
  /** ISO country code, e.g. "CZ". */
  country: string;
  /** ISO date, e.g. "2025-12-12". */
  date: string;
  description: string;
  amount: number;
  currency: "EUR" | "USD";
  cost_center: string;
  asset_no: string;
  approval: "single" | "second";
  status: "open" | "held" | "posted" | "pending_approval";
  /** Personal data: blur on screen, never send to Claude. */
  iban?: string;
  contact_name?: string;
  /** What the expert would do. For the mastery panel; never shown to the new hire up front. */
  answer_key?: {
    cost_center?: string;
    asset_no_required?: boolean;
    approval?: string;
    status?: string;
    gap?: boolean;
    why: string;
  };
}

/** A point in the screen recording. */
export interface Moment {
  /** "mm:ss" label. */
  t: string;
  /** Seconds into the recording, for replay. */
  clip_s: number;
  /** Session whose recording this moment is in (maps built from several sessions). Default: the map id. */
  session?: string;
}

export interface Step {
  id: string;
  title: string;
  moment: Moment;
  decision: string;
  /** The expert's own words. */
  reason: string;
  /** "mm:ss" when the expert said it. */
  said_at: string;
  guardrails: string[];
}

export type CheckOp = "eq" | "neq" | "gt" | "lt" | "contains" | "present";

export interface Condition {
  field: keyof Invoice;
  op: CheckOp;
  value?: string | number;
}

/** If every `when` condition matches and `require` does not hold, block the save. */
export interface GuardrailCheck {
  when: Condition[];
  require: Condition;
}

export interface Guardrail {
  id: string;
  text: string;
  /** The expert's own words, if they said it. */
  quote?: string;
  said_at?: string;
  check?: GuardrailCheck;
}

export interface OpenQuestion {
  id: string;
  /** Neutral wording. Never includes who asked. */
  q: string;
  context?: string;
  moment?: Moment;
  asked_by_count: number;
  /** Expert name. */
  route_to?: string;
  route_reason?: string;
  status: "open" | "answered";
  answer?: string;
  /** Who asked (learner names). Only shown to the askers themselves, never to experts. */
  askers?: string[];
  asked_at?: string;
  answered_at?: string;
}

export interface WorkMap {
  id: string;
  workflow: string;
  expert: string;
  team: string;
  confirmed: boolean;
  steps: Step[];
  guardrails: Guardrail[];
  open_questions: OpenQuestion[];
  updated_at: string;
  /** true for the seeded example map. */
  sample?: boolean;
  /** Session ids the map was built from. */
  sources?: string[];
}

// Matches data/experts.json. `name` is the unique key.
export interface Expert {
  name: string;
  title: string;
  team: string;
  topics: string[];
}

export interface TranscriptLine {
  /** ms since the recording started. */
  t: number;
  /** "other" = someone else heard on a call (record and learn with call audio). */
  speaker: "expert" | "agent" | "newhire" | "other";
  /** Raw speaker label from transcription, e.g. "speaker_1". */
  speaker_label?: string;
  text: string;
}

export interface SessionLog {
  id: string;
  /** "live" = Claudia asks while you work; "record" = record and learn, no questions. */
  mode: "capture" | "teach" | "quick_ask" | "live" | "record";
  started_at: string;
  ended_at?: string;
  /** Short title for the session list, e.g. "Supplier invoices (3)". */
  title?: string;
  /** The expert's own name for this piece of work. Parts of a resumed session share it. */
  name?: string;
  /** 1 for a new session, 2+ when an earlier session with the same name was continued. */
  part?: number;
  /** Set once a debrief turned this session into a Work Map. */
  reviewed_in?: string;
  expert?: string;
  events: ErpEvent[];
  transcript: TranscriptLine[];
  /** Spans taken off the record, in ms. */
  off_record?: { from: number; to: number }[];
}
