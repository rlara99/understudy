// Owner: Pablo. Screen share + recording for replay, plus frame grabs for /api/frame.
//
// The recording's start time is the zero point for the whole session: set the panel's
// startRef to the value start() returns, so every event's t lines up with the video.
import { useEffect, useRef, useState } from "react";
import { saveRecording } from "./recordings";

const MIME_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function useScreenRecorder() {
  const [recording, setRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const sessionId = useRef<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const stopped = useRef<Promise<Blob | null> | null>(null);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  /**
   * Ask the user which screen or tab to share and start recording.
   * Call it straight from a click handler (browsers require a user gesture).
   * Returns the start time (Date.now()), or null if the user cancelled.
   */
  async function start(id: string): Promise<number | null> {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    } catch (err) {
      setError((err as Error).name === "NotAllowedError" ? "Screen sharing was cancelled." : String(err));
      return null;
    }
    sessionId.current = id;
    chunks.current = [];
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    stopped.current = new Promise((resolve) => {
      rec.onstop = async () => {
        const blob = new Blob(chunks.current, { type: "video/webm" });
        setVideoUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        try {
          await saveRecording(id, blob);
        } catch (err) {
          setError(`Recording could not be stored: ${String(err)}`);
        }
        resolve(blob);
      };
    });
    // The browser's own "Stop sharing" button ends the recording too.
    stream.current.getVideoTracks()[0].addEventListener("ended", () => stop());

    rec.start(1000);
    recorder.current = rec;
    startedAt.current = Date.now();

    video.current = document.createElement("video");
    video.current.srcObject = stream.current;
    video.current.muted = true;
    await video.current.play();
    setRecording(true);
    return startedAt.current;
  }

  /** Stop sharing. Resolves with the recording once it is stored (null if nothing was recording). */
  function stop(): Promise<Blob | null> {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
    return stopped.current ?? Promise.resolve(null);
  }

  /** Current frame as base64 JPEG (no data: prefix), for POST /api/frame. */
  function grabFrame(maxWidth = 1280): string | null {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
  }

  /** ms since the recording started; matches the panel's event times when startRef = startedAt. */
  const elapsed = () => (startedAt.current ? Date.now() - startedAt.current : 0);

  return { recording, videoUrl, error, startedAt, sessionId, start, stop, grabFrame, elapsed };
}
