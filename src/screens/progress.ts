// Owner: Pablo. What the new hire did in teach mode: which saves went through and which
// guardrails stopped them. Kept in localStorage so the Library can show mastery too.
import { violatedGuardrails } from "../shared/guardrails";
import type { Guardrail, Invoice, Step, WorkMap } from "../shared/types";

const KEY = "understudy.progress";
const CHANGED = "understudy-progress";

export interface InvoiceProgress {
  /** Guardrail ids that blocked a save of this invoice. */
  blocked: string[];
  /** The invoice as it was finally saved. */
  saved?: Invoice;
}
export type Progress = Record<string, InvoiceProgress>;

export function readProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked */
  }
  dispatchEvent(new Event(CHANGED));
}

export function recordBlocked(invoice: string, guardrailIds: string[]) {
  const p = readProgress();
  const cur = p[invoice] ?? { blocked: [] };
  p[invoice] = { ...cur, blocked: [...new Set([...cur.blocked, ...guardrailIds])] };
  write(p);
}

export function recordSaved(invoice: Invoice) {
  const p = readProgress();
  p[invoice.id] = { blocked: p[invoice.id]?.blocked ?? [], saved: invoice };
  write(p);
}

export function resetProgress() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
  dispatchEvent(new Event(CHANGED));
}

/** Calls fn whenever progress changes, in this tab or another one. */
export function onProgress(fn: (p: Progress) => void): () => void {
  const handler = () => fn(readProgress());
  addEventListener(CHANGED, handler);
  addEventListener("storage", handler);
  return () => {
    removeEventListener(CHANGED, handler);
    removeEventListener("storage", handler);
  };
}

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
