// SHARED FILE: the work app (ERP) publishes, Understudy (panels) subscribes.
// Goes through the API server's relay, so the ERP can be a separate app in any browser
// while Understudy runs in Electron.
import { publish, subscribe } from "./relay";
import type { ErpEvent } from "./types";

const CHANNEL = "erp";

export function publishErpEvent(event: ErpEvent): void {
  publish(CHANNEL, event);
}

/** Returns an unsubscribe function. */
export function onErpEvent(handler: (event: ErpEvent) => void): () => void {
  return subscribe<ErpEvent>(CHANNEL, handler);
}

/** "mm:ss" for a millisecond offset. */
export function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
