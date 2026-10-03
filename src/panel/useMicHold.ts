// Owner: Renzo. Keeps background noise from cutting the agent off.
// The mic is closed from the moment the agent is expected to talk (we sent it a nudge, or the user just
// finished a sentence) until it has finished speaking. Noise in the 1–2 s while it prepares a reply
// would otherwise count as the user talking and cancel the reply.
import { useEffect, useRef, useState } from "react";

export function useMicHold() {
  const [held, setHeld] = useState(false);
  const speaking = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /** The agent should answer soon: close the mic, reopen after maxWaitMs if it never starts talking. */
  const hold = (maxWaitMs = 4000) => {
    setHeld(true);
    clear();
    timer.current = setTimeout(() => {
      if (!speaking.current) setHeld(false);
    }, maxWaitMs);
  };

  /** Call from the conversation's onModeChange. */
  const onMode = (mode: string) => {
    clear();
    if (mode === "speaking") {
      speaking.current = true;
      setHeld(true);
    } else {
      speaking.current = false;
      // Reopen just after the agent stops, so the user can answer.
      timer.current = setTimeout(() => setHeld(false), 250);
    }
  };

  useEffect(() => clear, []);
  return { held, hold, onMode };
}
