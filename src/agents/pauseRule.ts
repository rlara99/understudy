// Owner: Renzo. Decides when the interviewer may ask one question.
// Rule: the expert has been idle (no typing, no speech) for idleMs AND made a decision
// within decisionWindowMs AND we're under the question budget.

export interface PauseRuleOptions {
  idleMs: number;
  decisionWindowMs: number;
  maxQuestions: number;
  /** Minimum gap between two questions. Short for the demo; ~60 s in real use. */
  minGapMs: number;
}

export class PauseDetector {
  private lastActivity = 0;
  private lastDecision = 0;
  private lastAsked = 0;
  private pending: string | null = null;
  asked = 0;

  constructor(
    private opts: PauseRuleOptions = { idleMs: 3000, decisionWindowMs: 30000, maxQuestions: 4, minGapMs: 15000 },
  ) {}

  /** Typing, clicking or speaking. */
  activity(now = Date.now()): void {
    this.lastActivity = now;
  }

  /** A value changed in a way worth asking about, e.g. "cost center 4711 -> 0400 on INV-4471". */
  decision(summary: string, now = Date.now()): void {
    this.lastDecision = now;
    this.lastActivity = now;
    this.pending = summary;
  }

  /** The decision to ask about, or null if the agent should stay quiet. */
  check(agentSpeaking: boolean, now = Date.now()): string | null {
    const o = this.opts;
    if (agentSpeaking || !this.pending) return null;
    if (this.asked >= o.maxQuestions) return null;
    if (now - this.lastActivity < o.idleMs) return null;
    if (now - this.lastDecision > o.decisionWindowMs) return null;
    if (now - this.lastAsked < o.minGapMs) return null;
    return this.pending;
  }

  markAsked(now = Date.now()): void {
    this.asked += 1;
    this.lastAsked = now;
    this.pending = null;
  }
}
