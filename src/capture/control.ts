// Owner: Pablo. Capture state shared between the panel tab (which owns the recorder)
// and the ERP tab (which shows the "Off the record" button and banner).

const CHANNEL = "understudy-capture";

export type CaptureControl =
  /** Recorder → everyone: current state. */
  | { kind: "state"; recording: boolean; offRecord: boolean }
  /** ERP → recorder: please go off / back on the record. */
  | { kind: "request"; offRecord: boolean }
  /** New tab → recorder: tell me the current state. */
  | { kind: "ping" };

let sender: BroadcastChannel | null = null;

export function postControl(msg: CaptureControl) {
  sender ??= new BroadcastChannel(CHANNEL);
  sender.postMessage(msg);
}

/** Returns an unsubscribe function. */
export function onControl(fn: (msg: CaptureControl) => void): () => void {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (m: MessageEvent<CaptureControl>) => fn(m.data);
  return () => ch.close();
}
