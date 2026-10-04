// Live demo mode (VITE_DEMO=1): the hosted, read-only version of Understudy.
// - GET /api/* is served from a static snapshot in public/demo/ (same JSON the API returns).
// - Writes (AI, saves, deletes) answer 503 and show a note: Claude and voice run in the desktop app.
// - Sabrina's screen recording is loaded into IndexedDB so the walkthrough clips play.
// - Voice session routes (Claudia) show a note instead of opening the mic.
// Import this first in every entry point. Without VITE_DEMO it does nothing.
import { loadRecording, saveRecording } from "./capture/recordings";

export const DEMO = import.meta.env.VITE_DEMO === "1";
const SESSION_ID = "session-1791076533360";
const VOICE_ROUTES = /^#\/(work\/(live|record)|learner\/assistant|panel|tutor)(\/|$)/;

function toast(text: string) {
  document.getElementById("demo-toast")?.remove();
  const t = document.createElement("div");
  t.id = "demo-toast";
  t.textContent = text;
  Object.assign(t.style, {
    position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", zIndex: "2147483646", maxWidth: "640px",
    background: "#111827", color: "#fff", padding: "14px 20px", borderRadius: "14px", font: "500 15px/1.45 Inter, system-ui, sans-serif",
    boxShadow: "0 18px 50px rgba(0,0,0,.3)", textAlign: "center",
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
}

const NOTE_AI = "Live demo is read-only: Claude and Claudia's voice (ElevenLabs) run in the Understudy desktop app. Watch the product demo video to see them work.";

function tourPill() {
  const erp = location.pathname.startsWith("/erp");
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <button id="demo-pill" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;background:#111827;color:#fff;padding:9px 14px;border-radius:999px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)">
      <span style="width:8px;height:8px;border-radius:50%;background:#a78bfa"></span>Live demo · try it
    </button>
    <div id="demo-tour" hidden style="position:absolute;right:0;bottom:46px;width:340px;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:16px;padding:16px 18px;box-shadow:0 24px 60px rgba(0,0,0,.18);font:400 14px/1.5 Inter,system-ui,sans-serif">
      <b style="font-size:15px">Try Understudy</b>
      <ol style="margin:8px 0 10px 18px;padding:0">
        <li><a href="/#/learner/knowledge/${SESSION_ID}">Play Sabrina's walkthrough</a> (Knowledge Repository)</li>
        <li><a href="/#/map/${SESSION_ID}">Open her Work Map</a>: steps, reasons, guardrails</li>
        <li><a href="/erp/#/teach" target="_blank">Open the ERP as Lena</a>, select INV-5102 and click Save and post: Sabrina's rule blocks it</li>
        <li><a href="/#/expert/minute">Expert Minute</a>: a gap routed to Marta, asked by 3</li>
      </ol>
      <span style="color:#6b7280;font-size:13px">Read-only snapshot. Claude and Claudia's voice (ElevenLabs) run in the desktop app.</span>
    </div>`;
  Object.assign(wrap.style, { position: "fixed", right: erp ? "20px" : "24px", bottom: "20px", zIndex: "2147483645" });
  document.body.appendChild(wrap);
  const tour = wrap.querySelector<HTMLDivElement>("#demo-tour")!;
  wrap.querySelector("#demo-pill")!.addEventListener("click", () => (tour.hidden = !tour.hidden));
  if (!sessionStorage.getItem("demo-tour-seen")) {
    tour.hidden = false;
    sessionStorage.setItem("demo-tour-seen", "1");
  }
}

if (DEMO) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "GET") {
      const query = url.search ? "__" + url.search.slice(1).replace(/[^a-zA-Z0-9=]/g, "_") : "";
      const res = await realFetch(`/demo${url.pathname}${query}.json`);
      if (res.ok) return res;
      return new Response(JSON.stringify({ error: "Not in the demo snapshot" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (!url.pathname.startsWith("/api/relay/")) toast(NOTE_AI);
    return new Response(JSON.stringify({ error: NOTE_AI }), { status: 503, headers: { "Content-Type": "application/json" } });
  };

  // Voice sessions need a mic, ElevenLabs and the API: point to the video instead.
  let last = VOICE_ROUTES.test(location.hash) ? "#/learner/knowledge" : location.hash || "#/learner/knowledge";
  const guard = () => {
    if (VOICE_ROUTES.test(location.hash)) {
      location.replace(last);
      toast(NOTE_AI);
    } else last = location.hash;
  };
  if (!location.pathname.startsWith("/erp") && (!location.hash || location.hash === "#/")) location.replace("#/learner/knowledge");
  guard();
  addEventListener("hashchange", guard);

  // Sabrina's recording, so walkthrough clips play.
  loadRecording(SESSION_ID).then(async (rec) => {
    if (rec) return;
    try {
      const blob = await (await realFetch("/demo/sabrina.mp4")).blob();
      await saveRecording(SESSION_ID, blob, []);
    } catch (e) {
      console.warn("[demo] could not load the recording", e);
    }
  });

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", tourPill);
  else tourPill();
}
