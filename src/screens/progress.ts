// Owner: Pablo. What the new hire did in the work app: which saves went through and which
// guardrails stopped them.
//
// The ERP (a separate app) owns the record and shares it over the relay channel "progress":
//   ERP → { kind: "state", progress }  after every change and whenever asked
//   Understudy → { kind: "ping" }       on opening a screen, to get the current state
// Understudy keeps a copy so mastery still shows while the ERP is closed.
// No server storage: data/sessions is reserved for real session logs.
import { useEffect, useState } from "react";
import { violatedGuardrails } from "../shared/guardrails";
import { publish, subscribe } from "../shared/relay";
import type { Guardrail, Invoice, Step, WorkMap } from "../shared/types";

const CHANNEL = "progress";
const ERP_KEY = "understudy.erp.progress";
const VIEW_KEY = "understudy.progress.view";

export interface InvoiceProgress {
  /** Guardrail ids that blocked a save of this invoice. */
  blocked: string[];
  /** The invoice as it was finally saved. */
  saved?: Invoice;
}
export type Progress = Record<string, InvoiceProgress>;

type ProgressMsg = { kind: "state"; progress: Progress } | { kind: "ping" };

function read(key: string): Progress {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

function write(key: string, p: Progress) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* storage blocked: lives in memory for this page only */
  }
}

/* ---------- ERP side (the work app records what the trainee does) ---------- */

function erpUpdate(fn: (p: Progress) => void) {
  const p = read(ERP_KEY);
  fn(p);
  write(ERP_KEY, p);
  publish(CHANNEL, { kind: "state", progress: p } satisfies ProgressMsg);
}

export function recordBlocked(invoice: string, guardrailIds: string[]) {
  erpUpdate((p) => {
    const cur = p[invoice] ?? { blocked: [] };
    p[invoice] = { ...cur, blocked: [...new Set([...cur.blocked, ...guardrailIds])] };
  });
}

export function recordSaved(invoice: Invoice) {
  erpUpdate((p) => {
    p[invoice.id] = { blocked: p[invoice.id]?.blocked ?? [], saved: invoice };
  });
}

/** ERP: clear the trainee's record (on Reset demo). */
export function clearErpProgress() {
  erpUpdate((p) => {
    for (const k of Object.keys(p)) delete p[k];
  });
}

/** ERP: answer Understudy's pings with the current record. Returns an unsubscribe function. */
export function serveProgress(): () => void {
  return subscribe<ProgressMsg>(CHANNEL, (msg) => {
    if (msg.kind === "ping") publish(CHANNEL, { kind: "state", progress: read(ERP_KEY) } satisfies ProgressMsg);
  });
}

/* ---------- Understudy side (screens that show mastery) ---------- */

/** Understudy: forget the cached copy (on Reset demo; the ERP clears its own on the reset message). */
export function resetProgressView() {
  write(VIEW_KEY, {});
  publish(CHANNEL, { kind: "state", progress: {} } satisfies ProgressMsg);
}

/** Live new-hire progress for a React screen. */
export function useProgress(): Progress {
  const [progress, setProgress] = useState<Progress>(() => read(VIEW_KEY));
  useEffect(() => {
    const unsubscribe = subscribe<ProgressMsg>(CHANNEL, (msg) => {
      if (msg.kind !== "state") return;
      write(VIEW_KEY, msg.progress);
      setProgress(msg.progress);
    });
    // Ask the ERP (if it's open) for the latest; give the stream a moment to connect first.
    const t = setTimeout(() => publish(CHANNEL, { kind: "ping" } satisfies ProgressMsg), 400);
    return () => {
      clearTimeout(t);
      unsubscribe();
    };
  }, []);
  return progress;
}

/* ---------- mastery ---------- */

/** True when every `when` condition of the guardrail holds for this invoice. */
function applies(invoice: Invoice, g: Guardrail): boolean {
  if (!g.check) return false;
  // Reuse the shared evaluator: with a `require` that can never hold, it reports a
  // violation exactly when all the `when` conditions hold.
  const probe: Guardrail = { ...g, check: { when: g.check.when, require: { field: "id", op: "eq", value: "\u0000" } } };
  return violatedGuardrails(invoice, [probe]).length > 0;
}

export type StepStatus = "mastered" | "practice" | "not_seen";

export interface Mastery {
  steps: { step: Step; status: StepStatus; invoices: string[] }[];
  mastered: number;
  practice: number;
  /** 0-100, or null before the new hire has touched any checkable step. */
  score: number | null;
}

/**
 * A step is "practice" if any of its guardrails ever blocked a save (the tutor had to step in),
 * "mastered" if a saved invoice fell under one of its guardrails and nothing was blocked,
 * and "not_seen" otherwise.
 */
export function computeMastery(map: WorkMap, progress: Progress): Mastery {
  const steps = map.steps.map((step) => {
    const checks = map.guardrails.filter((g) => step.guardrails.includes(g.id) && g.check);
    let status: StepStatus = "not_seen";
    const invoices: string[] = [];
    for (const [id, p] of Object.entries(progress)) {
      if (p.blocked.some((b) => step.guardrails.includes(b))) {
        status = "practice";
        invoices.push(id);
      } else if (p.saved && checks.some((g) => applies(p.saved!, g))) {
        if (status === "not_seen") status = "mastered";
        invoices.push(id);
      }
    }
    return { step, status, invoices };
  });
  const mastered = steps.filter((s) => s.status === "mastered").length;
  const practice = steps.filter((s) => s.status === "practice").length;
  const seen = mastered + practice;
  return { steps, mastered, practice, score: seen ? Math.round((100 * mastered) / seen) : null };
}
