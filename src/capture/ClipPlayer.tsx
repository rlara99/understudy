// Owner: Pablo. Plays the expert's screen recording from a given moment.
// Used by the Work Map (click a step) and the tutor's replay_moment tool.
import { useEffect, useRef, useState } from "react";
import { loadRecording, toVideoSeconds, type Cut } from "./recordings";

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
  /** Called when the clip reaches its end while playing (used to chain clips into a walkthrough). */
  onClipEnd?: () => void;
  /** Called with false when there is nothing to play: no recording, or the moment is past its end. */
  onAvailable?: (available: boolean) => void;
}

const MAX_CLIP_S = 30;

export function ClipPlayer({ at, sessionId, leadIn = 3, after = 10, autoPlay = true, onClipEnd, onAvailable }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const onClipEndRef = useRef(onClipEnd);
  onClipEndRef.current = onClipEnd;
  const onAvailableRef = useRef(onAvailable);
  onAvailableRef.current = onAvailable;
  const [url, setUrl] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [missing, setMissing] = useState(false);
  const [outOfRange, setOutOfRange] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    // Fall back to the newest recording, e.g. for the hand-made sample map.
    loadRecording(sessionId)
      .then((rec) => rec ?? (sessionId ? loadRecording() : null))
      .then((rec) => {
        onAvailableRef.current?.(Boolean(rec));
        if (!rec) return setMissing(true);
        objectUrl = URL.createObjectURL(rec.blob);
        setCuts(rec.cuts);
        setUrl(objectUrl);
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    // Moments are in session time; off-the-record spans aren't in the video, so map them over.
    const startS = Math.max(0, at - leadIn);
    const target = toVideoSeconds(startS, cuts);
    // Show just the action: a few seconds before the moment to a few after, capped at 30 s.
    const end = toVideoSeconds(Math.min(at + after, startS + MAX_CLIP_S), cuts);
    // Only report the end after a real play-through (not while the duration fix jumps to the end).
    let armed = false;
    const finish = () => {
      if (!armed) return;
      armed = false;
      onClipEndRef.current?.();
    };
    const onTime = () => {
      if (!v.paused && v.currentTime >= target - 0.5 && v.currentTime < end) armed = true;
      if (v.currentTime >= end) {
        v.pause();
        finish();
      }
    };
    // Pressing play after the clip ended replays the clip, not the rest of the recording.
    const onPlay = () => {
      if (v.currentTime >= end - 0.2 || v.currentTime < target - 0.5) v.currentTime = target;
    };
    // Arm only once playback is actually running inside the clip: the duration fix's jump to the
    // end can deliver a late "ended" event that must not count as the clip finishing.
    const onPlaying = () => {
      if (v.currentTime >= target - 0.5 && v.currentTime < end) armed = true;
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("playing", onPlaying);
    // A moment near the end of the file can run out before `end`.
    v.addEventListener("ended", finish);
    const seek = () => {
      // The moment isn't in this recording (e.g. the sample map falling back to an unrelated one).
      const missingMoment = target >= v.duration - 0.25;
      setOutOfRange(missingMoment);
      onAvailableRef.current?.(!missingMoment);
      if (missingMoment) return;
      v.currentTime = target;
      if (autoPlay) v.play().catch(() => {});
    };
    // MediaRecorder files have no duration, which breaks seeking. Jumping far
    // past the end makes the browser scan the file and learn the real duration.
    // Wait for that jump to finish before seeking to the clip: otherwise the jump lands at the
    // end after we pressed play, and the browser pauses the clip right away.
    const fixed = () => {
      v.removeEventListener("durationchange", fixed);
      if (v.seeking) v.addEventListener("seeked", seek, { once: true });
      else seek();
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration)) return seek();
      v.addEventListener("durationchange", fixed);
      v.currentTime = 1e9;
    };
    if (v.readyState >= 1) onMeta();
    else v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", fixed);
      v.removeEventListener("seeked", seek);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("ended", finish);
    };
  }, [url, cuts, at, leadIn, after, autoPlay]);

  if (missing) return <p className="muted">No screen recording yet. Record a capture session first.</p>;
  return (
    <>
      <video ref={ref} src={url ?? undefined} controls muted playsInline hidden={outOfRange} style={{ width: "100%", borderRadius: 6 }} />
      {outOfRange && <p className="muted">This moment isn't in the stored recording.</p>}
    </>
  );
}
