// SHARED FILE: send messages between separate apps through the local API server.
// Works across browsers and Electron (unlike BroadcastChannel, which only reaches tabs of the same browser).
// Messages are delivered to every listener on the channel, including other listeners in the sending page.

/** Base URL of the API. Empty = same origin (Vite proxies /api). Set VITE_API_BASE for an app on another port. */
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/** Hosted live demo (no API server): tabs of the same browser talk through BroadcastChannel instead. */
const DEMO = import.meta.env.VITE_DEMO === "1";

export function publish(channel: string, message: unknown): void {
  if (DEMO) {
    // A fresh channel object per message, so listeners in this page receive it too (like the relay).
    const bc = new BroadcastChannel(`understudy-${channel}`);
    bc.postMessage(message);
    bc.close();
    return;
  }
  fetch(`${API}/api/relay/${channel}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
    keepalive: true,
  }).catch((e) => console.warn(`[relay] could not publish to ${channel}:`, e));
}

/** Listen to a channel. Reconnects on its own. Returns an unsubscribe function. */
export function subscribe<T>(channel: string, handler: (message: T) => void): () => void {
  if (DEMO) {
    const bc = new BroadcastChannel(`understudy-${channel}`);
    bc.onmessage = (e) => handler(e.data as T);
    return () => bc.close();
  }
  const source = new EventSource(`${API}/api/relay/${channel}`);
  source.onmessage = (e) => {
    try {
      handler(JSON.parse(e.data) as T);
    } catch (err) {
      console.warn(`[relay] bad message on ${channel}:`, err);
    }
  };
  return () => source.close();
}
