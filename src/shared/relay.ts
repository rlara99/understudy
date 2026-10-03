// SHARED FILE: send messages between separate apps through the local API server.
// Works across browsers and Electron (unlike BroadcastChannel, which only reaches tabs of the same browser).
// Messages are delivered to every listener on the channel, including other listeners in the sending page.

/** Base URL of the API. Empty = same origin (Vite proxies /api). Set VITE_API_BASE for an app on another port. */
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function publish(channel: string, message: unknown): void {
  fetch(`${API}/api/relay/${channel}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
    keepalive: true,
  }).catch((e) => console.warn(`[relay] could not publish to ${channel}:`, e));
}

/** Listen to a channel. Reconnects on its own. Returns an unsubscribe function. */
export function subscribe<T>(channel: string, handler: (message: T) => void): () => void {
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
