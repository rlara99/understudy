// Capture state shared between Understudy (which owns the recorder) and the
// separate ERP app (which shows the "Off the record" button and banner).
// Goes through the API relay so it works across apps, browsers and the Electron window.
import { publish, subscribe } from "../shared/relay";

const CHANNEL = "capture";

export type CaptureControl =
  /** Recorder → everyone: current state. */
  | { kind: "state"; recording: boolean; offRecord: boolean }
  /** ERP → recorder: please go off / back on the record. */
  | { kind: "request"; offRecord: boolean }
  /** New page → recorder: tell me the current state. */
  | { kind: "ping" }
  /** Understudy → ERP: Reset demo was pressed; drop local edits and reload. */
  | { kind: "reset" };

export function postControl(msg: CaptureControl) {
  publish(CHANNEL, msg);
}

/** Returns an unsubscribe function. The relay also delivers your own messages back to you. */
export function onControl(fn: (msg: CaptureControl) => void): () => void {
  return subscribe<CaptureControl>(CHANNEL, fn);
}
