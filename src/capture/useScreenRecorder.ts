// Owner: Pablo. Screen share + recording for replay, plus frame grabs for /api/frame.
//
// The recording's start time is the zero point for the whole session: set the panel's
// startRef to the value start() returns, so every event's t lines up with the video.
//
// Off the record: setOffRecord(true) pauses the recorder, so that footage is never recorded.
// It works from start() to stop(), also when no screen is shared, and a share that ends (the
// browser's "Stop sharing") keeps the session off the record: only stop() goes back on.
// The ERP's "Off the record" button asks for it over the capture channel, so the panel
// doesn't have to wire anything up; it only reads `offRecord` (to drop transcript lines)
// and offRecordSpans() (for SessionLog.off_record).
import { useEffect, useRef, useState } from "react";
import { onControl, postControl } from "./control";
import { saveRecording, type Cut } from "./recordings";

const MIME_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function useScreenRecorder() {
  const [recording, setRecording] = useState(false);
  const [offRecord, setOffRecordState] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const sessionId = useRef<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const stopped = useRef<Promise<Blob | null> | null>(null);
  const cuts = useRef<Cut[]>([]);
  const off = useRef(false);
  /** A session is running (start() until stop()), with or without a screen recording. */
  const active = useRef(false);

  // `recording` on the channel means a session is running, so the ERP keeps its button even without a video.
  const broadcast = () => postControl({ kind: "state", recording: active.current, offRecord: off.current });

  /** Go off the record (pause recording, if there is one) or back on. No-op outside a session. */
  function setOffRecord(on: boolean) {
    if (!active.current || on === off.current) return;
    const rec = recorder.current;
    const rolling = rec !== null && rec.state !== "inactive";
    const t = Date.now() - startedAt.current;
    if (on) {
      if (rolling) rec.pause();
      cuts.current.push({ from: t, to: t });
    } else {
      if (rolling) rec.resume();
      cuts.current[cuts.current.length - 1].to = t;
    }
    off.current = on;
    setOffRecordState(on);
    broadcast();
  }

  // The ERP tab asks to go off/on the record, or asks for the current state when it opens.
  const setOffRecordRef = useRef(setOffRecord);
  setOffRecordRef.current = setOffRecord;
  useEffect(
    () =>
      onControl((msg) => {
        if (msg.kind === "request") setOffRecordRef.current(msg.offRecord);
        if (msg.kind === "ping") broadcast();
      }),
    [],
  );

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  /**
   * Ask the user which screen or tab to share and start recording.
   * Call it straight from a click handler (browsers require a user gesture).
   * Returns the start time (Date.now()), or null if the user cancelled (the session still runs, without a video).
   */
  async function start(id: string): Promise<number | null> {
    setError(null);
    let shared: MediaStream | null = null;
    try {
      shared = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    } catch (err) {
      setError((err as Error).name === "NotAllowedError" ? "Screen sharing was cancelled." : String(err));
    }
    sessionId.current = id;
    chunks.current = [];
    // Already off the record stays off: only stop() goes back on.
    cuts.current = off.current ? [{ from: 0, to: 0 }] : [];
    active.current = true;
    if (!shared) {
      // Same clock as the panel's own Date.now() zero, so off-record spans still line up.
      startedAt.current = Date.now();
      broadcast();
      return null;
    }
    stream.current = shared;
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(shared, mimeType ? { mimeType } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    stopped.current = new Promise((resolve) => {
      rec.onstop = async () => {
        const blob = new Blob(chunks.current, { type: "video/webm" });
        setVideoUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        try {
          await saveRecording(id, blob, cuts.current);
        } catch (err) {
          setError(`Recording could not be stored: ${String(err)}`);
        }
        resolve(blob);
      };
    });
    // The browser's own "Stop sharing" button ends the video (it is kept). The session and off the record go on.
    shared.getVideoTracks()[0].addEventListener("ended", () => {
      if (rec.state !== "inactive") rec.stop();
      setRecording(false);
    });

    rec.start(1000);
    if (off.current) rec.pause();
    recorder.current = rec;
    startedAt.current = Date.now();

    video.current = document.createElement("video");
    video.current.srcObject = stream.current;
    video.current.muted = true;
    await video.current.play();
    setRecording(true);
    broadcast();
    return startedAt.current;
  }

  /** End the session: stop sharing, back on the record. Resolves with the recording once it is stored (null if nothing was recording). */
  function stop(): Promise<Blob | null> {
    // Close an open off-the-record span (before rec.stop(): the stored recording reads the cuts).
    if (off.current) cuts.current[cuts.current.length - 1].to = Date.now() - startedAt.current;
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    active.current = false;
    off.current = false;
    setOffRecordState(false);
    setRecording(false);
    broadcast();
    return stopped.current ?? Promise.resolve(null);
  }

  /** Current frame as base64 JPEG (no data: prefix), for POST /api/frame. Null while off the record. */
  function grabFrame(maxWidth = 1280): string | null {
    const v = video.current;
    if (off.current || !v || !v.videoWidth) return null;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
  }

  /** ms since the recording started; matches the panel's event times when startRef = startedAt. */
  const elapsed = () => (startedAt.current ? Date.now() - startedAt.current : 0);

  /** Spans taken off the record so far, in ms since start (an open one ends now). Matches SessionLog.off_record. */
  const offRecordSpans = (): Cut[] =>
    cuts.current.map((c, i) => (off.current && i === cuts.current.length - 1 ? { ...c, to: Date.now() - startedAt.current } : { ...c }));

  return {
    recording,
    offRecord,
    setOffRecord,
    offRecordSpans,
    videoUrl,
    error,
    startedAt,
    sessionId,
    start,
    stop,
    grabFrame,
    elapsed,
  };
}
