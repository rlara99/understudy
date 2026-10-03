// Owner: Renzo. Message relay between separate apps (the ERP in a browser, Understudy in Electron).
// POST /api/relay/:channel  { ...message }  -> delivered to every listener on that channel
// GET  /api/relay/:channel                  -> Server-Sent Events stream of that channel's messages
import { Router, type Response } from "express";

export const relayRoutes = Router();

const listeners = new Map<string, Set<Response>>();

const channelName = (raw: string) => {
  if (!/^[a-z0-9-]{1,40}$/i.test(raw)) throw new Error(`Invalid channel: ${raw}`);
  return raw;
};

relayRoutes.get("/relay/:channel", (req, res) => {
  const channel = channelName(req.params.channel);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  const set = listeners.get(channel) ?? new Set<Response>();
  set.add(res);
  listeners.set(channel, set);
  // Comment lines keep proxies and the browser from closing an idle stream.
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => {
    clearInterval(keepAlive);
    set.delete(res);
  });
});

relayRoutes.post("/relay/:channel", (req, res) => {
  const channel = channelName(req.params.channel);
  const data = `data: ${JSON.stringify(req.body)}\n\n`;
  listeners.get(channel)?.forEach((client) => client.write(data));
  res.status(204).end();
});
