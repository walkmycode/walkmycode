// The body of POST /api/claude: one streamText step for the saved provider,
// with WalkMyCode's tools declared but never executed, forwarded to the browser
// as the SSE events in wire.ts. It lives here rather than in the route file
// so tests can hand it a fake fetch (a route file may only export handlers).
import type { AgentId } from "./agents";
import "server-only";
import { z } from "zod";
import { PROVIDER_IDS, PROVIDERS } from "./catalogue";
import { readiness, resolve } from "./config";
import { classify, friendly } from "./errors";
import { HttpError } from "./guard";
import { keyFor } from "./keys";
import { cliRound } from "./cli";
import { callOptions, makeModel, normaliseUsage, stepCountIs, streamText, systemMessages, toSdkTools, type FetchLike } from "./sdk";
import { toModelMessages, type AskRequest, type StreamEvent } from "./wire";

// Shape checks only: assistant entries are opaque and go back to the SDK as they came.
const Entry = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    content: z.union([
      z.string(),
      z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("text"), text: z.string() }),
            z.object({ type: z.literal("image"), image: z.string().max(4_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/), mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]) }),
          ]),
        )
        .min(1)
        .max(5),
    ]),
  }),
  z.object({ role: z.literal("assistant"), message: z.looseObject({ role: z.literal("assistant") }) }),
  z.object({ role: z.literal("tool"), content: z.array(z.looseObject({ type: z.literal("tool-result"), toolCallId: z.string(), toolName: z.string() })) }),
]);
const Body = z.object({
  history: z.array(Entry).min(1),
  history_provider: z.enum(PROVIDER_IDS).nullable(),
  mode: z.enum(["ask", "tour"]),
  mapSummary: z.string(),
});

/**
 * The handler, minus the guard (the route wraps it in `guarded`). Readiness
 * and a provider switch mid-conversation come back as `{type:'error'}` on
 * the stream, like a provider failure would, so the browser has one path.
 */
export function askHandler(deps: { fetch?: FetchLike } = {}) {
  return async (req: Request): Promise<Response> => {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const body = parsed.data as AskRequest;
    const { resolved } = resolve();

    const enc = new TextEncoder();
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (ev: StreamEvent) => {
          if (open) controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        };
        try {
          const notReady = await readiness(resolved, deps.fetch);
          if (notReady) return send({ type: "error", error: notReady });
          if (body.history_provider && body.history_provider !== resolved.provider) return send({ type: "error", error: friendly("stale_history", { provider: resolved.provider }) });
          // Claude Code on this computer, on the user's plan: its own run, not the SDK (./cli.ts).
          if (PROVIDERS[resolved.provider].wire === "cli") {
            return await cliRound({ provider: resolved.provider as AgentId, model: resolved.model, mode: body.mode, mapSummary: body.mapSummary, history: body.history, toolUrl: cliToolUrl(req.url), signal: req.signal, send });
          }
          const key = keyFor(resolved.provider);
          if (!key) return send({ type: "error", error: friendly("missing_key", { provider: resolved.provider }) });

          let failed: unknown;
          const result = streamText({
            model: makeModel(resolved, key.value, deps.fetch),
            tools: toSdkTools(body.mode, resolved.provider),
            messages: [...systemMessages(body.mode, body.mapSummary, resolved.provider), ...toModelMessages(body.history)],
            stopWhen: stepCountIs(1),
            abortSignal: req.signal,
            onError: ({ error }) => {
              failed = error;
            },
            ...callOptions(resolved, body.mapSummary),
          });
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") send({ type: "text", text: part.text });
            else if (part.type === "tool-input-start") send({ type: "tool", name: part.toolName });
            else if (part.type === "abort") return;
            else if (part.type === "error") {
              failed = part.error;
              break;
            }
          }
          if (req.signal.aborted) return;
          if (failed !== undefined) return send({ type: "error", error: classify(failed, resolved.provider, resolved.base_url) });

          const [response, finish, toolCalls, usage] = await Promise.all([result.response, result.finishReason, result.toolCalls, result.usage]);
          const message = response.messages[0];
          if (!message || message.role !== "assistant") throw new Error("The provider sent no assistant message.");
          send({
            type: "message",
            message,
            finish,
            toolCalls: toolCalls.map((t) => ({ toolCallId: t.toolCallId, toolName: t.toolName, input: (t.input ?? {}) as Record<string, unknown> })),
            usage: normaliseUsage(usage),
            provider: resolved.provider,
            model: resolved.model,
          });
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

/** Where a run's bridge sends tool calls: always this server on loopback (the route accepts nothing
 * else), whatever address the page was opened on (WALKMYCODE_ALLOW_REMOTE). */
export function cliToolUrl(reqUrl: string): string {
  const u = new URL(reqUrl);
  return `${u.protocol}//127.0.0.1${u.port ? `:${u.port}` : ""}/api/cli-tool`;
}
