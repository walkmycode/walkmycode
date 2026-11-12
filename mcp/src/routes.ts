// The local routes of WalkMyCode for Claude's page server (docs/MCP.md §2.4, §6):
// what the page needs besides the map and the code, each a web Request in and
// a Response out, so they are the very handlers the full app's /api/voice/*
// routes run (src/lib/voice/routes.ts), bundled here.
//  - POST /api/answers: the user's answers ("Where does this point?") for the
//    open workspace, saved under ~/.walkmycode and the map rebuilt with them;
//  - GET/POST /api/mcp/settings: how a spoken question is answered (the talk
//    mode), in ~/.walkmycode/mcp.json;
//  - POST/DELETE /api/config/key: a voice key (ElevenLabs, Deepgram, Groq) saved to
//    ~/.walkmycode/keys.env, or removed, or ({ use_found: true }) copied from
//    the full app's keys.env (src/lib/providers/keys.ts). Only `has_key` ever comes back;
//  - GET/POST /api/config, GET /api/config/readiness and /models, POST /api/claude:
//    the page's own AI provider (Settings → AI model), the full app's provider
//    layer, used only when the AI app isn't listening (src/lib/bridge/fallback.ts);
//    POST /api/config/key also takes the providers' keys for it;
//  - the voice routes: config, voices, speak, token, settings, the
//    ElevenAgents session (its signed link minted here, with the user's key)
//    and transcribe (Talk through Claude with Groq, Deepgram or ElevenLabs),
//    and on-device speech to text (Parakeet: /api/voice/parakeet and its stream);
//  - GET/POST /api/localrun: "Run on: This computer" and the terminal
//    (src/lib/localrun): the user's consent, the toolchains and shells found;
//    the socket itself is web.ts's, behind the same cookie and Origin.
// web.ts lets a request reach these only with this launch's cookie, from the
// page's own Origin, as JSON; every handler also runs inside guarded(), which
// checks loopback and same-origin again and never echoes a thrown message.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Assertion } from "../../src/analyzer/types";
import { askHandler } from "../../src/lib/providers/ask";
import { keyEnvAllowlist } from "../../src/lib/providers/catalogue";
import * as providerConfig from "../../src/lib/providers/configRoutes";
import { guarded, HttpError } from "../../src/lib/providers/guard";
import { deleteKey, envStatus, copyFoundKey, writeKey } from "../../src/lib/providers/keys";
import { STT_KEY_ENVS } from "../../src/lib/voice/catalogue";
import type { LocalRun } from "../../src/lib/localrun/hub";
import { LOCALRUN_SOCKET_PATH } from "../../src/lib/localrun/protocol";
import { localRunHandlers } from "../../src/lib/localrun/routes";
import { actionHandler as parakeetActionHandler, statusHandler as parakeetStatusHandler, streamHandler as parakeetStreamHandler } from "../../src/lib/voice/parakeet/routes";
import { configGetHandler, configPostHandler, elevenSessionHandler, settingsHandler, speakHandler, tokenHandler, transcribeHandler, voicesHandler, type FetchLike } from "../../src/lib/voice/routes";
import { lanternDir } from "./workspace";

export type Handler = (req: Request) => Promise<Response>;

export interface ApiOptions {
  /** Keep the user's answers for the workspace with this id; false when it is no longer the open one. */
  saveAnswers(workspaceId: string, answers: Assertion[]): Promise<boolean>;
  /** Write an edited file back into the open workspace's folder (the code view's Save): null when written,
   * else why not. Left out, the route answers 404 (the page then downloads the file, as before). */
  saveFile?(workspaceId: string, path: string, text: string): Promise<{ status: number; why: string } | null>;
  /** "Choose folder…": the system's folder dialog, the path picked or null when cancelled (mcp/src/pickFolder.ts). */
  pickFolder?(): Promise<string | null>;
  /** Map a folder the person picked on the page, as walkmycode_open does: null when open, else why not. */
  openFolder?(path: string): Promise<{ status: number; why: string } | null>;
  /** Tests stand in for the voice vendors. */
  fetch?: FetchLike;
  /** Running code and terminals on this computer, once the user allows it. */
  localRun?: LocalRun;
}

/** The largest body a route takes (a map summary for the lecturer runs to a few hundred KB). */
export const BODY_LIMIT = 2 * 1024 * 1024;
/** Push to talk sends up to a minute of audio, as base64 in JSON. */
export const TRANSCRIBE_LIMIT = 10 * 1024 * 1024;

/** A question asked with the page's own key carries the conversation, and up to four pasted images (about 3 MB each). */
export const ASK_LIMIT = 20 * 1024 * 1024;

export const bodyLimit = (path: string): number => (path === "/api/voice/transcribe" ? TRANSCRIBE_LIMIT : path === "/api/claude" ? ASK_LIMIT : BODY_LIMIT);

const NO_STORE = { "cache-control": "no-store" };

function issues(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

// ── the talk mode (~/.walkmycode/mcp.json) ──

export const TALK_MODES = ["claude", "lecturer", "free"] as const;
export type TalkMode = (typeof TALK_MODES)[number];

const mcpPath = () => join(lanternDir(), "mcp.json");

/** The page's settings kept by the server: {} when there are none. */
export function readMcpSettings(): { talk?: TalkMode } {
  try {
    const raw = JSON.parse(readFileSync(mcpPath(), "utf8")) as { talk?: unknown };
    return TALK_MODES.includes(raw.talk as TalkMode) ? { talk: raw.talk as TalkMode } : {};
  } catch {
    return {};
  }
}

function writeMcpSettings(s: { talk: TalkMode }): void {
  const path = mcpPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

// ── the bodies ──

const AnswersBody = z.object({
  workspace: z.string().min(1).max(200),
  answers: z
    .array(
      z.object({
        setting: z.string().min(1).max(300),
        host: z.string().min(1).max(300).optional(),
        service: z.string().min(1).max(300).nullable(),
        answeredAt: z.string().min(1).max(60),
      }),
    )
    .max(500),
});

const SettingsBody = z.object({ talk: z.enum(TALK_MODES) });
const OpenFolderBody = z.object({ path: z.string().min(1).max(2000) });
const SaveFileBody = z.object({ workspace: z.string().min(1).max(200), path: z.string().min(1).max(1000), text: z.string().max(BODY_LIMIT) });
/** The voice keys and the Groq key (speech to text), and the model providers' keys (Settings → AI model: the page
 * answers with one when the AI app isn't listening, src/lib/bridge/fallback.ts). */
export const PAGE_KEY_ENVS: readonly string[] = [...new Set<string>([...STT_KEY_ENVS, ...keyEnvAllowlist()])];
const EnvVar = z.string().refine((v) => PAGE_KEY_ENVS.includes(v));
const SetKey = z.union([z.object({ env_var: EnvVar, value: z.string().max(2000) }), z.object({ env_var: EnvVar, use_found: z.literal(true) })]);
const DropKey = z.object({ env_var: EnvVar });

/** Every local route, by "METHOD /path". */
export function apiRoutes(o: ApiOptions): Map<string, Handler> {
  const deps = o.fetch ? { fetch: o.fetch } : {};
  const routes: [string, Handler][] = [
    [
      "POST /api/answers",
      async (req) => {
        const p = AnswersBody.safeParse(await req.json());
        if (!p.success) throw new HttpError(400, issues(p.error));
        const answers: Assertion[] = p.data.answers.map((a) => ({ setting: a.setting, ...(a.host ? { host: a.host } : {}), service: a.service, answeredAt: a.answeredAt }));
        if (!(await o.saveAnswers(p.data.workspace, answers))) throw new HttpError(409, "That workspace is no longer the one open: reload the page.");
        return Response.json({ ok: true, answers: answers.length }, { headers: NO_STORE });
      },
    ],
    [
      "POST /api/folder/pick",
      async () => {
        if (!o.pickFolder) throw new HttpError(404, "This server can't show a folder dialog.");
        try {
          return Response.json({ path: await o.pickFolder() }, { headers: NO_STORE });
        } catch (e) {
          throw new HttpError(501, (e as Error).message);
        }
      },
    ],
    [
      "POST /api/folder/open",
      async (req) => {
        const p = OpenFolderBody.safeParse(await req.json());
        if (!p.success) throw new HttpError(400, issues(p.error));
        if (!o.openFolder) throw new HttpError(404, "This server can't open a folder from the page.");
        const refused = await o.openFolder(p.data.path);
        if (refused) throw new HttpError(refused.status, refused.why);
        return Response.json({ ok: true }, { headers: NO_STORE });
      },
    ],
    [
      "POST /api/files/save",
      async (req) => {
        const p = SaveFileBody.safeParse(await req.json());
        if (!p.success) throw new HttpError(400, issues(p.error));
        if (!o.saveFile) throw new HttpError(404, "This server can't write files.");
        const refused = await o.saveFile(p.data.workspace, p.data.path, p.data.text);
        if (refused) throw new HttpError(refused.status, refused.why);
        return Response.json({ ok: true, path: p.data.path }, { headers: NO_STORE });
      },
    ],
    ["GET /api/mcp/settings", async () => Response.json({ talk: "claude", ...readMcpSettings() }, { headers: NO_STORE })],
    [
      "POST /api/mcp/settings",
      async (req) => {
        const p = SettingsBody.safeParse(await req.json());
        if (!p.success) throw new HttpError(400, issues(p.error));
        writeMcpSettings({ talk: p.data.talk });
        return Response.json({ ok: true, talk: p.data.talk }, { headers: NO_STORE });
      },
    ],
    [
      "POST /api/config/key",
      async (req) => {
        const p = SetKey.safeParse(await req.json());
        if (!p.success) throw new HttpError(400, "WalkMyCode keeps only the voice keys (ELEVENLABS_API_KEY, DEEPGRAM_API_KEY, GROQ_API_KEY) and the AI providers' keys, with a value.");
        if ("use_found" in p.data) {
          // The key the full app (or another WalkMyCode) already saved, copied file to file.
          if (!copyFoundKey(p.data.env_var)) throw new HttpError(404, "That key is no longer saved in your other WalkMyCode. Paste it here instead.");
        } else {
          if (!p.data.value.trim()) throw new HttpError(400, "Paste a key first.");
          writeKey(p.data.env_var, p.data.value);
        }
        return Response.json({ ok: true, has_key: envStatus(p.data.env_var).has_key }, { headers: NO_STORE });
      },
    ],
    [
      "DELETE /api/config/key",
      async (req) => {
        const p = DropKey.safeParse(await req.json());
        if (!p.success) throw new HttpError(400, "Name the key to remove: a voice key (ELEVENLABS_API_KEY, DEEPGRAM_API_KEY, GROQ_API_KEY) or an AI provider's.");
        deleteKey(p.data.env_var);
        return Response.json({ ok: true, has_key: envStatus(p.data.env_var).has_key }, { headers: NO_STORE });
      },
    ],
    // The page's own AI provider (Settings → AI model), for when the AI app isn't listening (src/lib/bridge/fallback.ts):
    // the app's provider settings and its one-step ask, the tools run by the page against its own copy of the code.
    ["GET /api/config", providerConfig.configGetHandler()],
    ["POST /api/config", providerConfig.configPostHandler()],
    ["GET /api/config/readiness", providerConfig.readinessHandler()],
    ["GET /api/config/models", providerConfig.modelsHandler()],
    ["POST /api/claude", askHandler(o.fetch ? { fetch: o.fetch } : {})],
    ["GET /api/voice/config", configGetHandler()],
    ["POST /api/voice/config", configPostHandler()],
    ["GET /api/voice/voices", voicesHandler(deps)],
    ["POST /api/voice/speak", speakHandler(deps)],
    ["POST /api/voice/token", tokenHandler(deps)],
    ["GET /api/voice/settings", settingsHandler()],
    ["POST /api/voice/elevenagents/session", elevenSessionHandler(deps)],
    ["POST /api/voice/transcribe", transcribeHandler(deps)],
    // On-device speech to text (Parakeet): the model's standing, and the microphone in small pieces.
    ["GET /api/voice/parakeet", parakeetStatusHandler()],
    ["POST /api/voice/parakeet", parakeetActionHandler()],
    ["POST /api/voice/parakeet/stream", parakeetStreamHandler()],
  ];
  if (o.localRun) {
    // The page connects to this server's own socket path; the cookie is its key, so no token is handed out.
    const lr = localRunHandlers(o.localRun, async () => ({ url: LOCALRUN_SOCKET_PATH, token: null }));
    routes.push(["GET /api/localrun", lr.GET], ["POST /api/localrun", lr.POST]);
  }
  return new Map(routes.map(([k, h]) => [k, guarded(h)]));
}
