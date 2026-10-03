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
  /** Stop this many seconds after the moment. The clip never runs longer than 30 s. */
  after?: number;
  autoPlay?: boolean;
}

const MAX_CLIP_S = 30;

export function ClipPlayer({ at, sessionId, leadIn = 3, after = 10, autoPlay = true }: Props) {
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
    // Show just the action: a few seconds before the moment to a few after, capped at 30 s.
    const end = Math.min(at + after, target + MAX_CLIP_S);
    const onTime = () => {
      if (v.currentTime >= end) v.pause();
    };
    // Pressing play after the clip ended replays the clip, not the rest of the recording.
    const onPlay = () => {
      if (v.currentTime >= end - 0.2 || v.currentTime < target - 0.5) v.currentTime = target;
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
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
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
    };
  }, [url, at, leadIn, after, autoPlay]);

  if (missing) return <p className="muted">No screen recording yet. Record a capture session first.</p>;
  return <video ref={ref} src={url ?? undefined} controls muted playsInline style={{ width: "100%", borderRadius: 6 }} />;
}
