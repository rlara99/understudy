// Owner: Pablo. Plays the expert's screen recording from a given moment.
// Used by the Work Map (click a step) and the tutor's replay_moment tool.
import { useEffect, useRef, useState } from "react";
import { loadRecording } from "./recordings";

interface Props {
  /** Seconds into the recording (a Step's moment.clip_s). */
  at: number;
  /** Session the recording belongs to; omit to use the newest recording. */
  sessionId?: string;
  /** Start this many seconds early so the viewer sees the lead-up. */
  leadIn?: number;
  autoPlay?: boolean;
}

export function ClipPlayer({ at, sessionId, leadIn = 2, autoPlay = true }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    // Fall back to the newest recording, e.g. for the hand-made sample map.
    loadRecording(sessionId)
      .then((blob) => blob ?? (sessionId ? loadRecording() : null))
      .then((blob) => {
      if (!blob) return setMissing(true);
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    const target = Math.max(0, at - leadIn);
    const seek = () => {
      v.currentTime = target;
      if (autoPlay) v.play().catch(() => {});
    };
    // MediaRecorder files have no duration, which breaks seeking. Jumping far
    // past the end makes the browser scan the file and learn the real duration.
    const onMeta = () => {
      if (Number.isFinite(v.duration)) return seek();
      const fixed = () => {
        v.removeEventListener("durationchange", fixed);
        seek();
      };
      v.addEventListener("durationchange", fixed);
      v.currentTime = 1e9;
    };
    if (v.readyState >= 1) onMeta();
    else v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [url, at, leadIn, autoPlay]);

  if (missing) return <p className="muted">No screen recording yet. Record a capture session first.</p>;
  return <video ref={ref} src={url ?? undefined} controls muted playsInline style={{ width: "100%", borderRadius: 6 }} />;
}
