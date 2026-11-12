# WalkMyCode

**Find your way around the code you generated.**

Walk through any codebase: a map, guided tours and a voice that explains. Open a folder, or several that make one system, and see a map of it arranged by layer — pages, API routes, logic, database, outside services — with the real links between them (the *Sign out* button → `POST /account/signout` → `core/account.py` → the `sessions` table). Click any card or select any lines and ask, in plain English, what it does. Ask for a guided tour and follow a feature end to end.

Built for people who made an app with an AI and now can't find their way around it.

**Status:** early prototype. Map, explain, trace and text tours work on TypeScript/JavaScript (React, Next.js, Express, Cloudflare Pages) and Python (FastAPI, Flask) with SQL, Prisma and Supabase tables. The code can be one app, a monorepo of packages, or several services that talk over HTTP, gRPC or queues: WalkMyCode reads `docker-compose.yml`, Kubernetes files, Dockerfiles and the like to find the services, shows a system view with one card per service, and lets you open each one. Tours and answers can be read aloud, and you can talk to the guide. **WalkMyCode as an MCP server** (below) is the same page driven by your own AI app (Claude, Antigravity, Cursor…).

## Run it

You bring your own API keys; there is no hosted service and nothing to sign up for.

```bash
npm install
npm run dev
```

Open http://localhost:3000, pick a model and paste its key under **Model & keys** (or copy `.env.example` to `.env.local` and fill it in before starting), then add one folder or several (Chrome or Edge can open folders directly; other browsers get a file picker). Several folders — say a web app and the services it calls, each in its own repo — make one workspace and one map; each folder's paths start with its name.

WalkMyCode works with Anthropic (Claude, the default), OpenAI, Google Gemini, Groq, DeepSeek, xAI (Grok), and a local Ollama or LM Studio server. Switch in **Settings** at any time; no restart needed.

**Source control** (the branch button in the top bar, once you allow WalkMyCode to run things on this computer): see what changed and each file's diff, tick files, write the message or have the guide write it from the diff, Commit or Commit & push, Pull, discard a file's changes, switch or make a branch, read the last commits, and settle a merge's conflicts (keep mine, keep theirs, or I fixed it, then Finish or Abort). It runs your own `git` with your own GitHub sign-in, so WalkMyCode stores no token; if git asks you to sign in, run `git push` once in the terminal (Ctrl+`).

For a large repo, index it once from the command line and it appears under "Indexed repos":

```bash
npm run index -- ../path/to/repo
npm run index -- ../web ../services --name shop   # several folders, one map
```

## WalkMyCode as an MCP server (built here, not published yet)

The same map, driven by **your own AI app** (Claude Desktop, Claude Code, Antigravity, Cursor, VS Code or any other MCP client) instead of an API key: it explains while WalkMyCode lights up the cards and the lines and reads aloud, and Explain, Trace it, Tour, a typed question or one said out loud on the page go to it. The page names the app it is connected to. Apps that stop listening after a task are covered: the page asks the app's model directly when it allows that (MCP sampling), or answers with a key you add in its Settings. Details in `docs/MCP.md`.

```bash
npm run build:mcp      # the page (out-mcp) + the server → mcp/dist, with the Claude Code plugin in mcp/dist/plugin
npm run pack:mcpb      # the Claude Desktop extension → mcp/dist/walkmycode.mcpb
npm run e2e:mcp        # the real page in headless Chrome against the real server
```

Install by hand (nothing is installed for you):
- **Claude Code**: `claude --plugin-dir <this repo>/mcp/dist/plugin` for one session, or `claude plugin marketplace add <this repo>/mcp/dist` then `claude plugin install walkmycode@walkmycode-local`. Then run `/walkmycode` in a project. Without the plugin: `claude mcp add walkmycode -- node <this repo>/mcp/dist/server.mjs`.
- **Claude Desktop**: open `mcp/dist/walkmycode.mcpb` (double-click, or Settings → Extensions → Advanced settings → Install Extension…), then say "open WalkMyCode on ~/code/my-app".
- **Any other MCP client** (Antigravity, Cursor, VS Code, Windsurf, Zed, the Gemini CLI…): add a stdio server that runs `node <this repo>/mcp/dist/server.mjs`, then ask it to "open WalkMyCode on ~/code/my-app".

**No AI app at all? Run it from a terminal** with a folder: it maps the folder, prints the page's link (and opens it), and the page answers with the AI key you add in its Settings → AI model (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`… in the environment). Ctrl+C stops it.

```bash
node mcp/dist/server.mjs .                     # this folder (once published: npx walkmycode-mcp .)
node mcp/dist/server.mjs open ~/code/my-app    # or any folder; several folders make one workspace (--name to name it)
node mcp/dist/server.mjs --help
```

Run with no folder, it is the MCP server an AI app starts (stdin a pipe); run bare in a terminal, it prints the help.

The page listens on `127.0.0.1` only, with a key in its link for each launch. Maps and your answers are kept in `~/.walkmycode/workspaces/`; voice keys you add in the page's Settings → Voice, and an AI key in Settings → AI model, go to `~/.walkmycode/keys.env`.

## What leaves your machine

- The map is built by a parser (tree-sitter) **in your browser tab**. Nothing is uploaded to build it.
- When you ask a question, the lines the model needs to answer it, plus the question, go to **the one provider you picked** in Settings, on your key: **Anthropic (Claude)** by default, or **OpenAI**, **Google Gemini**, **Groq**, **DeepSeek**, **xAI (Grok)**, or a **local server** (Ollama, LM Studio), in which case nothing leaves your computer. **DeepSeek's servers are in China and its terms allow training on inputs**; Gemini's free tier may use your traffic to improve Google products. The model reads files through tools that run in your browser; the Next.js server only forwards requests and never stores code.
- Voice (Settings → Voice): the text read aloud goes to the narrator you pick, **ElevenLabs** (the default) or **Deepgram**, on your key; your browser's own voice needs no key and sends nothing anywhere WalkMyCode controls. **Talk** sends your microphone audio and the conversation to the lecturer you pick, **ElevenLabs** (the default; WalkMyCode keeps one private agent in your ElevenLabs account, whose prompt holds the map's summary) or **Deepgram** (sent with `mip_opt_out`); both run Claude for the replies. Questions the lecturer hands to the typed guide go to your Language model provider, as typed questions do. Push-to-talk is the default: the microphone is sent only while you hold Space or the Talk button.
- Speech to text on this computer (Settings → Voice → **On this computer (Parakeet)**): your voice is turned into text by the WalkMyCode server on your own machine, and the audio never leaves it. Getting the speech model is one download from GitHub (about 460 MB), only when you ask for it.
- Files that look like secrets (`.env`, `.env.local`, `.env.production` and any other `.env*` file except the examples, `*.pem`, `*.key`) are never read. The example files (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`) are read for the addresses of your services, and any value that looks like a password or key is hidden before it is shown or sent.
- Config files (`docker-compose.yml`, Kubernetes YAML, Dockerfiles, `next.config`, nginx, OpenAPI, `.proto`) are read in your browser, like the code, to find the services and how they reach each other.
- A cost meter in the top bar shows what the session has spent, from the usage the API reports.

## How the map stays honest

Every arrow carries the file and line that proves it; an arrow between two services also carries the config line that says where the request goes (for example the `USERS_URL` line in `docker-compose.yml`). If the parser can only pattern-match (a URL built from a variable, a call whose HTTP method it can't see), the arrow is dashed and labelled as a guess, with the reason. If there is no evidence, there is no arrow. The AI labels and explains; it never adds links.

## Settings

The **Settings** tab (and the **Model & keys** card on the first screen) picks the provider, model and effort and takes keys. What it saves beats `.env.local`; `.env.local` beats the built-in default.

| Variable | Meaning |
|---|---|
| `WALKMYCODE_PROVIDER` | `anthropic` (default), `openai`, `gemini`, `groq`, `deepseek`, `xai` or `local` |
| `WALKMYCODE_MODEL` | the provider's model id; default `claude-opus-5-5` (`claude-sonnet-5-5` costs about half) or the provider's own default |
| `WALKMYCODE_EFFORT` | `low`, `medium` (default) or `high`: thinking or reasoning effort where the model has one; low is cheapest |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `XAI_API_KEY` | xAI (Grok) |
| `LOCAL_BASE_URL` | local server address; default `http://localhost:11434/v1` (Ollama), LM Studio is `http://localhost:1234/v1` |
| `LOCAL_API_KEY` | optional bearer token for a local server |
| `WALKMYCODE_ALLOW_REMOTE` | `1` lets other machines reach the settings and ask endpoints; leave unset |
| `ELEVENLABS_API_KEY` | voice: narration (the default narrator) and the ElevenLabs lecturer (the default for Talk) |
| `DEEPGRAM_API_KEY` | voice: Aura-2 narration and the Deepgram lecturer (the cheaper Talk) |

Only the key for the provider you use is needed.

### Files in `.walkmycode/`

The `.walkmycode/` folder in the project is gitignored and stays on your computer.

| File | Holds |
|---|---|
| `.walkmycode/config.json` | the provider, model, effort and local server address saved in Settings; under `voice`, the narrator, voice, speed and lecturer, and the id of the ElevenLabs agent WalkMyCode made for Talk |
| `.walkmycode/keys.env` | keys pasted in Settings, one `NAME=value` line each. Written and read only by the WalkMyCode server; the browser only ever learns whether a key is set. The server tries to make it readable by you alone, which has no effect on Windows, where it is as private as your user folder. |
| `.walkmycode/<name>.map.json`, `.walkmycode/<name>.files.json` | repos indexed with `npm run index` |

Delete a file to forget what it holds.

**Renamed from Lantern.** WalkMyCode was called Lantern before, and what you saved then keeps working: when there is no `.walkmycode/` (or `~/.walkmycode/`) folder, an existing `.lantern/` (or `~/.lantern/`) folder is read and written in place, never moved or deleted; the old `LANTERN_*` variables are read when the `WALKMYCODE_*` ones are not set; and settings this browser saved under the old names are still picked up.

### Only this computer

The settings and ask endpoints answer only requests addressed to `localhost`, `127.0.0.1` or `[::1]` from WalkMyCode's own page, so another site open in your browser cannot spend your keys. `next dev` also listens on your local network by default; to keep other machines from reaching WalkMyCode at all, start it bound to loopback:

```bash
npm run dev -- -H 127.0.0.1
```

### Checking a provider

`npm run smoke` runs a real two-step tool loop and a tour hand-in against every provider you have a key for (`npm run smoke -- --provider local` for Ollama or LM Studio). It costs a few cents and prints each step's finish reason, tool calls, token usage and cost; `docs/PROVIDERS.md` §10 has the results so far.

## Licence

WalkMyCode is free software under the **GNU Affero General Public License v3.0** (`AGPL-3.0-only`, see [LICENSE](LICENSE)). You may use, change and share it; if you run a changed version for other people over a network, you must offer them its source too.
