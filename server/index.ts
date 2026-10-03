// Owner: Renzo. Small API server; Vite proxies /api here.
import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import { aiRoutes } from "./routes/ai";
import { dataRoutes } from "./routes/data";

const app = express();
app.use(express.json({ limit: "15mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, claudeKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});
app.use("/api", dataRoutes);
app.use("/api", aiRoutes);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
};
app.use(onError);

const port = Number(process.env.API_PORT ?? 8787);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
