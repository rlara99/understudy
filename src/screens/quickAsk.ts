// Owner: Pablo. Hand-off from the Expert Minute inbox to the voice panel.
// The inbox stores the question and opens #/panel; the panel calls takePendingQuickAsk()
// on mount, switches to quick_ask mode, and on confirm POSTs /api/patch with these ids.

export interface PendingQuickAsk {
  workmapId: string;
  questionId: string;
  question: string;
  context?: string;
  /** Expert name the question was routed to. */
  expert?: string;
}

const KEY = "understudy.quickAsk";

export function setPendingQuickAsk(q: PendingQuickAsk) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage blocked: the panel opens without a question */
  }
}

/** Reads and clears the pending question (null if there is none). */
export function takePendingQuickAsk(): PendingQuickAsk | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as PendingQuickAsk) : null;
  } catch {
    return null;
  }
}
