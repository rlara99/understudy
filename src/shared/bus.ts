// SHARED FILE: the ERP tab publishes, the apprentice panel subscribes.
// BroadcastChannel works across tabs of the same origin (localhost:5173).
import type { ErpEvent } from "./types";

const CHANNEL = "erp";
let sender: BroadcastChannel | null = null;

export function publishErpEvent(event: ErpEvent): void {
  sender ??= new BroadcastChannel(CHANNEL);
  sender.postMessage(event);
}

/** Returns an unsubscribe function. */
export function onErpEvent(handler: (event: ErpEvent) => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (msg: MessageEvent<ErpEvent>) => handler(msg.data);
  return () => channel.close();
}

/** "mm:ss" for a millisecond offset. */
export function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
