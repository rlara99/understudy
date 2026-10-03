// Owner: Pablo. Screen share + recording for replay, plus frame grabs for /api/frame.
import { useRef, useState } from "react";

export function useScreenRecorder() {
  const [recording, setRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const startedAt = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);

  async function start() {
    stream.current = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    chunks.current = [];
    recorder.current = new MediaRecorder(stream.current, { mimeType: "video/webm" });
    recorder.current.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    recorder.current.onstop = () => setVideoUrl(URL.createObjectURL(new Blob(chunks.current, { type: "video/webm" })));
    recorder.current.start(1000);
    startedAt.current = Date.now();
    video.current = document.createElement("video");
    video.current.srcObject = stream.current;
    video.current.muted = true;
    await video.current.play();
    setRecording(true);
  }

  function stop() {
    recorder.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
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

  return { recording, videoUrl, startedAt, start, stop, grabFrame };
}
