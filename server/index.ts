// Owner: Renzo. Small API server; Vite proxies /api here.
import "./env";
import express, { type ErrorRequestHandler } from "express";
import { aiRoutes } from "./routes/ai";
import { dataRoutes } from "./routes/data";
import { deleteRoutes } from "./routes/deletes";
import { renameRoutes } from "./routes/renames";
import { relayRoutes } from "./routes/relay";

const app = express();
app.use(express.json({ limit: "15mb" }));
// Record and learn uploads raw audio to /api/transcribe.
app.use("/api/transcribe", express.raw({ type: () => true, limit: "200mb" }));
// Separate local apps (e.g. the ERP on another port) may call the API directly.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, claudeKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});
app.use("/api", relayRoutes);
app.use("/api", dataRoutes);
app.use("/api", deleteRoutes);
app.use("/api", renameRoutes);
app.use("/api", aiRoutes);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
};
app.use(onError);

const port = Number(process.env.API_PORT ?? 8787);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
