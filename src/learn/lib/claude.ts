/**
 * Where the Learn room's AI and storage come from.
 * - WalkMyCode Lite (a Claude artifact): the viewer's own Claude, through the
 *   runtime the artifact viewer provides (window.claude.use).
 * - WalkMyCode (the app): the professor's AI is POST /api/learn on WalkMyCode's
 *   provider layer (tutor.ts); storage falls back to this browser's.
 */

export type SampleError = {
  code: string;
  message: string;
  text?: string;
  /** The app's own words for the failure, naming the provider in use (src/lib/providers/errors.ts). Shown as they are. */
  said?: string;
};

export type SampleOptions = {
  onText?: (u: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  modelTier?: "default" | "complex" | "quick";
  /** The most the reply may be, in tokens: a small step of a lesson asks for little, so a provider's per-minute limit is not spent on room it does not use. The app only. */
  maxOutput?: number;
  cache?: boolean | { gcTime?: number; refresh?: boolean };
};

export type Sample = ((input: string | { role: "user" | "assistant"; content: string }[], opts?: SampleOptions) =>
  Promise<{ text: string; truncated: boolean }>) & {
  json: <T = unknown>(input: string, opts?: SampleOptions) => Promise<T>;
};

type Snapshot = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };
export type DocRef = {
  get(): Promise<Snapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): CollRef;
};
export type CollRef = {
  doc(id?: string): DocRef;
  get(): Promise<{ docs: Snapshot[] }>;
};
export type Db = { doc(path: string): DocRef; collection(path: string): CollRef };
type User = { id(): Promise<string | null> };

type Runtime = { use(name: string): Promise<unknown> };
const runtime = (): Runtime | null =>
  typeof window !== "undefined" ? ((window as unknown as { claude?: Runtime }).claude ?? null) : null;

const capability = async <T,>(name: string): Promise<T | null> => {
  const r = runtime();
  if (!r) return null;
  try {
    return ((await r.use(name)) as T) ?? null;
  } catch {
    return null;
  }
};

export type McpResult = { content: { type: string; text?: string }[]; payload?: unknown };
export type McpError = { code: string; message: string };
export type Mcp = {
  callTool(server: string, tool: string, input?: unknown, opts?: { signal?: AbortSignal; cache?: false }): Promise<McpResult>;
  listTools(server?: string): Promise<{ servers: { server: string; tools: { name: string }[] }[] }>;
};

/**
 * The artifact's Claude inside a viewer; WalkMyCode's own AI route in the app.
 *
 * It resolves to a function (a Sample). Storing it in React state needs the
 * updater form, `setSample(() => sample)`: `setSample(sample)` makes React call
 * it as an updater, which posts `{ input: null }` to /api/learn.
 */
export const getSample = async (): Promise<Sample | null> => {
  if (runtime()) return capability<Sample>("sample");
  const { apiTutor } = await import("./tutor");
  return apiTutor;
};
export const getMcp = () => capability<Mcp>("mcp");
export const getDb = () => capability<Db>("db");
export const getUserId = async () => {
  const u = await capability<User>("user");
  try {
    return u ? await u.id() : null;
  } catch {
    return null;
  }
};

/** Viewer-facing words for a failed Claude call. */
export function sampleMessage(e: unknown): string {
  const code = (e as SampleError)?.code;
  if (code === "cancelled") return "";
  // The app's provider layer has already said it, with the provider's own name.
  const said = (e as SampleError)?.said;
  if (said) return said;
  switch (code) {
    case "cancelled":
      return "";
    case "not_granted":
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
      return "The professor needs your permission to use Claude. Reload the page and choose Allow.";
    case "not_configured":
      return "The professor needs an AI provider. Choose one and add its key in WalkMyCode's Settings.";
    case "rate_limited":
      return "The AI's usage limit has been reached for now. Try again in a little while.";
    case "session_expired":
      return "Your Claude sign-in has expired. Sign in again, then try once more.";
    case "refused":
      return "The professor could not answer that. Try asking it another way.";
    case "invalid_json":
      return "The lesson came back in a form the board cannot read. Try again.";
    case "prompt_too_large":
      return "That was too much to send at once. Try something shorter.";
    default:
      return "Something went wrong reaching the AI. Try again.";
  }
}
