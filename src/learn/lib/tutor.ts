/**
 * The professor's AI in the full WalkMyCode app: the same shape as the Claude
 * artifact's `sample` (see claude.ts), backed by POST /api/learn, which uses
 * whatever provider WalkMyCode is set to. So every Learn component works the
 * same in the artifact (WalkMyCode Lite) and in the app.
 */
import { labelOf } from "@/lib/providers/catalogue";
import type { Sample, SampleError, SampleOptions } from "./claude";

type Input = Parameters<Sample>[0];
type FriendlyError = { code?: string; title?: string; message?: string; status?: number; detail?: string; provider?: string };

/** A provider refusing a request for its size: HTTP 413, or its per-minute token limit named in what it said. */
const TOO_LARGE = /request too large|too large for model|tokens per minute|\bTPM\b|context length|maximum context|too many tokens/i;

/** WalkMyCode's error codes, in the artifact's words, so one set of copy serves both. */
export function toSampleError(e: FriendlyError | undefined, text: string): SampleError {
  const tooLarge = e?.status === 413 || TOO_LARGE.test(`${e?.detail ?? ""} ${e?.message ?? ""}`);
  const who = e?.provider ? labelOf(e.provider) : "The AI provider";
  // The provider's name comes with the app's own wording (title and message), so say exactly that.
  const said = tooLarge
    ? `${who} would not take that much at once on this plan. Try again: Learn sends a long lesson in smaller steps. If it still fails, choose a model with a larger limit, or another provider, in Settings.`
    : e?.title && e?.message
      ? `${e.title}. ${e.message}`
      : e?.message || e?.title || "";
  const code = tooLarge
    ? "prompt_too_large"
    : e?.code === "rate_limited" || e?.code === "out_of_credits"
      ? "rate_limited"
      : e?.code === "missing_key" || e?.code === "invalid_key" || e?.code === "no_model"
        ? "not_configured"
        : "upstream_error";
  return { code, message: e?.message || e?.title || "The AI could not answer.", ...(said ? { said } : {}), ...(text ? { text } : {}) };
}

async function ask(input: Input, opts: SampleOptions = {}, json = false): Promise<{ text: string; truncated: boolean }> {
  let res: Response;
  try {
    res = await fetch("/api/learn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, json, ...(opts.maxOutput ? { max_output: Math.round(opts.maxOutput) } : {}) }),
      signal: opts.signal,
    });
  } catch {
    if (opts.signal?.aborted) throw { code: "cancelled", message: "Stopped." } satisfies SampleError;
    throw { code: "upstream_error", message: "WalkMyCode's server could not be reached." } satisfies SampleError;
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: FriendlyError | string } | null;
    const err = typeof body?.error === "string" ? { message: body.error } : body?.error;
    throw toSampleError(err, "");
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, cut).replace(/^data: /, "");
        buf = buf.slice(cut + 2);
        if (!line) continue;
        // Explore's StreamEvent shapes (src/lib/providers/wire.ts).
        const ev = JSON.parse(line) as { type: string; text?: string; finish?: string; error?: FriendlyError };
        if (ev.type === "text" && ev.text) {
          text += ev.text;
          opts.onText?.({ text, delta: ev.text });
        } else if (ev.type === "message") truncated = ev.finish === "length";
        else if (ev.type === "error") throw toSampleError(ev.error, text);
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) throw { code: "cancelled", message: "Stopped.", ...(text ? { text } : {}) } satisfies SampleError;
    throw (e as SampleError)?.code ? e : { code: "upstream_error", message: "The answer was cut off.", ...(text ? { text } : {}) };
  }
  if (!text.trim()) throw { code: "empty_completion", message: "The AI gave no answer." } satisfies SampleError;
  return { text, truncated };
}

/** Read JSON the way the artifact's sample.json does: whole reply, a fenced
 *  block, or the span from the first { or [ to the last } or ]. */
export function parseJsonReply(text: string): unknown {
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1].trim());
  const a = text.search(/[[{]/);
  const b = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  throw { code: "invalid_json", message: "The reply was not valid JSON.", text } satisfies SampleError;
}

export const apiTutor: Sample = Object.assign((input: Input, opts?: SampleOptions) => ask(input, opts), {
  json: async <T,>(input: string, opts?: SampleOptions): Promise<T> => {
    const { text, truncated } = await ask(input, opts, true);
    if (truncated) throw { code: "invalid_json", message: "The reply was cut short.", text } satisfies SampleError;
    return parseJsonReply(text) as T;
  },
});
