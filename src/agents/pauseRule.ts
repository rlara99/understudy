// Owner: Renzo. Decides when the interviewer may ask a question in the MIDDLE of a task.
// The main trigger is "task done" (invoice saved or left), handled in the panel.
// Mid-task, only important decisions (see IMPORTANT_FIELDS, vision judgment calls) are asked, after a short pause.
// Minor ones are only kept for the task-done question.

export const IMPORTANT_FIELDS = new Set(["cost_center", "approval", "status"]);

export interface PauseRuleOptions {
  /** Quiet time needed before asking about an important decision (just "not mid-typing"). */
  urgentIdleMs: number;
  /** Forget decisions older than this. */
  decisionWindowMs: number;
  maxQuestions: number;
  /** Minimum gap between two questions. Short for the demo; ~60 s in real use. */
  minGapMs: number;
}

interface Pending {
  summary: string;
  important: boolean;
  at: number;
}

export class PauseDetector {
  private lastActivity = 0;
  private lastAsked = 0;
  private queue: Pending[] = [];
  asked = 0;

  constructor(
    private opts: PauseRuleOptions = {
      urgentIdleMs: 2500,
      decisionWindowMs: 45000,
      maxQuestions: 8,
      minGapMs: 8000,
    },
  ) {}

  /** Typing or speaking. */
  activity(now = Date.now()): void {
    this.lastActivity = now;
  }

  /** A value changed in a way worth asking about, e.g. "cost center 4711 -> 0400 on INV-4471". */
  decision(summary: string, important: boolean, now = Date.now()): void {
    this.queue.push({ summary, important, at: now });
    if (this.queue.length > 3) {
      const minor = this.queue.findIndex((p) => !p.important);
      this.queue.splice(minor >= 0 ? minor : 0, 1);
    }
  }

  /** The decision to ask about now, or null if the agent should stay quiet. */
  check(agentSpeaking: boolean, now = Date.now()): string | null {
    const o = this.opts;
    this.queue = this.queue.filter((p) => now - p.at <= o.decisionWindowMs);
    if (agentSpeaking || this.queue.length === 0) return null;
    if (this.asked >= o.maxQuestions || now - this.lastAsked < o.minGapMs) return null;
    // Minor decisions never interrupt mid-task: the task-done question covers them.
    const next = this.queue.find((p) => p.important);
    if (!next || now - this.lastActivity < o.urgentIdleMs) return null;
    return next.summary;
  }

  /** Drop pending decisions for an invoice (its task-done nudge covers them). */
  forget(invoice: string): void {
    this.queue = this.queue.filter((p) => !p.summary.includes(invoice));
  }

  /** Count a question asked outside check() (e.g. a task-done nudge). */
  countAsked(now = Date.now()): void {
    this.asked += 1;
    this.lastAsked = now;
  }

  markAsked(summary: string, now = Date.now()): void {
    this.asked += 1;
    this.lastAsked = now;
    this.queue = this.queue.filter((p) => p.summary !== summary);
  }
}
