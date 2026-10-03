// Owner: Renzo. Watches the screen without recording it (Learner · Assistant): grabs a frame every few
// seconds, asks /api/frame what changed, and hands the result to the caller. Nothing is stored.
import { useEffect, useRef, useState } from "react";
import { postJson } from "../shared/api";

export interface FrameResult {
  app: string;
  changes: string[];
  task_done: string | null;
  judgment_call: string | null;
}

export function useScreenWatch(onFrame: (r: FrameResult) => void, opts: { everyMs?: number; paused?: () => boolean } = {}) {
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const handler = useRef(onFrame);
  handler.current = onFrame;
  const paused = useRef(opts.paused);
  paused.current = opts.paused;

  async function start() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch {
      setError("Screen sharing was cancelled. The assistant can still use the ERP and your voice.");
      return false;
    }
    video.current = document.createElement("video");
    video.current.srcObject = stream.current;
    video.current.muted = true;
    await video.current.play();
    stream.current.getVideoTracks()[0].addEventListener("ended", stop);
    setWatching(true);
    return true;
  }

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setWatching(false);
  }

  useEffect(() => {
    if (!watching) return;
    let busy = false;
    let last = "";
    let previous: string | undefined;
    const id = setInterval(async () => {
      const v = video.current;
      if (busy || !v || !v.videoWidth || paused.current?.()) return;
      const scale = Math.min(1, 1024 / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth * scale;
      canvas.height = v.videoHeight * scale;
      canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
      const frame = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      if (frame === last) return;
      last = frame;
      busy = true;
      try {
        const r = await postJson<FrameResult>("/api/frame", { image: frame, previous });
        if (r.changes.length || r.task_done) {
          previous = `${r.app}: ${[...r.changes, r.task_done ?? ""].filter(Boolean).join("; ")}`;
          handler.current(r);
        }
      } catch (e) {
        setError(`Screen watch: ${String(e).slice(0, 80)}`);
      } finally {
        busy = false;
      }
    }, opts.everyMs ?? 4000);
    return () => clearInterval(id);
  }, [watching, opts.everyMs]);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  return { watching, error, start, stop };
}
