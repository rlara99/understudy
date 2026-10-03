// Owner: Renzo. Record and learn: records the mic (the expert) and, opt-in, the computer's sound
// (a call's other participants) as separate tracks, and transcribes them with ElevenLabs via /api/transcribe.
// Audio is cut into segments (every ~90 s, and around off-the-record pauses) so the transcript fills in
// as you work and every line's time matches the screen recording.
import { useRef, useState } from "react";
import type { TranscriptLine } from "../shared/types";

const SEGMENT_MS = 90_000;
const MIME = ["audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

interface Track {
  rec: MediaRecorder;
  speaker: "expert" | "other";
  chunks: Blob[];
}

export function useAudioTranscriber() {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [active, setActive] = useState(false);
  const [callAudio, setCallAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const linesRef = useRef<TranscriptLine[]>([]);
  const t0 = useRef(0);
  const segStart = useRef(0);
  const mic = useRef<MediaStream | null>(null);
  const call = useRef<MediaStream | null>(null);
  const tracks = useRef<Track[]>([]);
  const pending = useRef<Promise<void>[]>([]);
  const roll = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLines = (more: TranscriptLine[]) => {
    linesRef.current = [...linesRef.current, ...more].sort((a, b) => a.t - b.t);
    setLines(linesRef.current);
  };

  async function upload(blob: Blob, speaker: Track["speaker"], offset: number) {
    if (blob.size < 4000) return; // a second or so of silence: nothing to transcribe
    setUploading((n) => n + 1);
    try {
      const r = await fetch(`/api/transcribe?speaker=${speaker}&offset=${Math.round(offset)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      const data = (await r.json()) as { lines?: TranscriptLine[]; error?: string };
      if (!r.ok) setError(data.error ?? `Transcription failed (${r.status})`);
      else addLines(data.lines ?? []);
    } catch (e) {
      setError(`Transcription failed: ${String(e)}`);
    } finally {
      setUploading((n) => n - 1);
    }
  }

  function startSegment() {
    segStart.current = Date.now();
    const sources: [MediaStream | null, Track["speaker"]][] = [
      [mic.current, "expert"],
      [call.current, "other"],
    ];
    tracks.current = sources
      .filter((s): s is [MediaStream, Track["speaker"]] => Boolean(s[0]))
      .map(([stream, speaker]) => {
        const rec = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
        const track: Track = { rec, speaker, chunks: [] };
        rec.ondataavailable = (e) => e.data.size && track.chunks.push(e.data);
        rec.start(1000);
        return track;
      });
  }

  function stopSegment() {
    const offset = segStart.current - t0.current;
    for (const track of tracks.current) {
      const done = new Promise<Blob>((resolve) => {
        track.rec.onstop = () => resolve(new Blob(track.chunks, { type: MIME || "audio/webm" }));
      });
      if (track.rec.state !== "inactive") track.rec.stop();
      pending.current.push(done.then((blob) => upload(blob, track.speaker, offset)));
    }
    tracks.current = [];
  }

  /** Start recording. `zero` = the screen recording's start time, so line times match the video. */
  async function start(opts: { zero: number; micId?: string; withCallAudio: boolean }) {
    setError(null);
    t0.current = opts.zero;
    linesRef.current = [];
    setLines([]);
    mic.current = await navigator.mediaDevices.getUserMedia({
      audio: opts.micId ? { deviceId: { exact: opts.micId } } : true,
    });
    call.current = null;
    setCallAudio(false);
    if (opts.withCallAudio) {
      // In the desktop app this returns the computer's sound ("loopback") without a picker.
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        s.getVideoTracks().forEach((t) => t.stop());
        if (s.getAudioTracks().length) {
          call.current = new MediaStream(s.getAudioTracks());
          setCallAudio(true);
        } else setError("Call audio isn't available here. Only your mic is recorded.");
      } catch {
        setError("Call audio was not shared. Only your mic is recorded.");
      }
    }
    startSegment();
    roll.current = setInterval(() => {
      if (tracks.current.length) {
        stopSegment();
        startSegment();
      }
    }, SEGMENT_MS);
    setActive(true);
  }

  /** Off the record: stop recording audio (nothing from this span is kept). */
  function pause() {
    if (tracks.current.length) stopSegment();
  }

  /** Back on the record. */
  function resume() {
    if (active && tracks.current.length === 0) startSegment();
  }

  /** Stop, wait for every segment to be transcribed, and return the full transcript. */
  async function stop(): Promise<TranscriptLine[]> {
    if (roll.current) clearInterval(roll.current);
    roll.current = null;
    if (tracks.current.length) stopSegment();
    mic.current?.getTracks().forEach((t) => t.stop());
    call.current?.getTracks().forEach((t) => t.stop());
    mic.current = call.current = null;
    setActive(false);
    await Promise.all(pending.current);
    pending.current = [];
    return linesRef.current;
  }

  return { lines, active, callAudio, error, transcribing: uploading > 0, start, pause, resume, stop };
}
