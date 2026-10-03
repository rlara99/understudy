// Owner: Renzo. One place for Claude calls. Key comes from ANTHROPIC_API_KEY in .env.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const client = new Anthropic();

export const MODELS = {
  /** Work Map, routing, patching: quality matters. */
  main: process.env.MAP_MODEL ?? "claude-opus-5-5",
  /** Screen frames every ~1.5 s: speed matters. */
  frames: process.env.FRAME_MODEL ?? "claude-haiku-4-5",
};

/** Ask Claude for JSON that matches a zod schema. Throws if it can't parse. */
export async function askJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const response = await client.messages.parse({
    model: opts.model ?? MODELS.main,
    max_tokens: opts.maxTokens ?? 16000,
    output_config: { effort: "medium", format: zodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (!response.parsed_output) throw new Error(`No parsed output (stop_reason: ${response.stop_reason})`);
  return response.parsed_output;
}
