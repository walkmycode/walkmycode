// The body of POST /api/learn: one streamed text answer for the Learn room's
// professor (lessons, answers, marking), through the same provider choice as
// POST /api/claude: resolve() → readiness() → keyFor() → makeModel(), the
// effort setting and output cap from textOptions(), and provider failures
// through classify(). No tools and no map: every prompt carries everything it
// needs. The events are the StreamEvent shapes in wire.ts, which the browser
// side (src/learn/lib/tutor.ts) reads. A subscription provider (wire "cli": Claude Code, Codex)
// answers through cli.ts's cliText instead, with no key. It lives here rather than in the route
// file so tests can hand it a fake fetch (a route file may only export handlers).
import "server-only";
import { z } from "zod";
import { PROVIDERS } from "./catalogue";
import { readiness, resolve } from "./config";
import type { AgentId } from "./agents";
import { classify, friendly } from "./errors";
import { HttpError } from "./guard";
import { keyFor } from "./keys";
import { makeModel, normaliseUsage, streamText, textOptions, type FetchLike } from "./sdk";
import type { StreamEvent } from "./wire";

const Turn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(262_144) });
const Body = z.object({
  input: z.union([z.string().min(1).max(262_144), z.array(Turn).min(1).max(200)]),
  json: z.boolean().optional(),
  /** A cap on this answer (Learn's step-by-step lesson writer sends ~3000 a step), so a provider with a
   * small per-minute token limit isn't charged for room the answer won't use. Only ever lowers the cap. */
  max_output: z.number().int().min(256).max(32_000).optional(),
});

/**
 * A lesson is one long reply (a dozen boards of JSON) on top of the model's own
 * thinking, and the default answer cap cuts it off mid-board. So a JSON reply
 * (a lesson, a roadmap) gets this much room on the providers whose models all
 * allow it; the others keep the catalogue's cap.
 */
export const LESSON_MAX_OUTPUT = 20_000;
const ROOMY = new Set(["anthropic", "openai", "gemini", "xai"]);

/** What a subscription app is told it is, in place of its own coding-assistant instructions. */
export const LEARN_SYSTEM = "You are the professor in WalkMyCode's Learn room: a patient teacher. Follow the instructions in the student's message exactly; it carries everything you need. You have no tools and no files: answer from what the message gives you.";

export const JSON_RULE = "Your reply will be read by a program: reply with only the JSON value asked for, with no other text and no code fence.";

/**
 * The handler, minus the guard (the route wraps it in `guarded`). Readiness
 * problems come back as `{type:'error'}` on the stream, like a provider
 * failure would, so the browser has one path.
 */
export function learnHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const { input, json, max_output } = parsed.data;
    const { resolved } = resolve();

    const enc = new TextEncoder();
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (ev: StreamEvent) => {
          if (open) controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        };
        try {
          // A subscription app on this computer (Claude Code, Codex, the Gemini CLI): no key, its own run.
          if (PROVIDERS[resolved.provider].wire === "cli") {
            const { cliText } = await import("./cli");
            return await cliText({
              provider: resolved.provider as AgentId,
              model: resolved.model,
              system: [LEARN_SYSTEM, json ? JSON_RULE : ""].filter(Boolean).join("\n\n"),
              turns: typeof input === "string" ? [{ role: "user", content: input }] : input,
              signal: req.signal,
              send,
            });
          }
          const notReady = await readiness(resolved, deps.fetch);
          if (notReady) return send({ type: "error", error: notReady });
          const key = keyFor(resolved.provider);
          if (!key) return send({ type: "error", error: friendly("missing_key", { provider: resolved.provider }) });

          let failed: unknown;
          const options = textOptions(resolved, "learn");
          if (json && ROOMY.has(resolved.provider)) options.maxOutputTokens = Math.max(options.maxOutputTokens, LESSON_MAX_OUTPUT);
          if (max_output) options.maxOutputTokens = Math.min(options.maxOutputTokens, max_output);
          const result = streamText({
            model: makeModel(resolved, key.value, deps.fetch),
            ...(json ? { system: JSON_RULE } : {}),
            messages: typeof input === "string" ? [{ role: "user" as const, content: input }] : input,
            abortSignal: req.signal,
            onError: ({ error }) => {
              failed = error;
            },
            ...options,
          });
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") send({ type: "text", text: part.text });
            else if (part.type === "abort") return;
            else if (part.type === "error") {
              failed = part.error;
              break;
            }
          }
          if (req.signal.aborted) return;
          if (failed !== undefined) return send({ type: "error", error: classify(failed, resolved.provider, resolved.base_url) });

          const [response, finish, usage] = await Promise.all([result.response, result.finishReason, result.usage]);
          const message = response.messages[0];
          if (!message || message.role !== "assistant") throw new Error("The provider sent no assistant message.");
          send({ type: "message", message, finish, toolCalls: [], usage: normaliseUsage(usage), provider: resolved.provider, model: resolved.model });
        } catch (e) {
          if (!req.signal.aborted) send({ type: "error", error: classify(e, resolved.provider, resolved.base_url) });
        } finally {
          if (open) {
            open = false;
            controller.close();
          }
        }
      },
      cancel() {
        open = false;
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  };
}
