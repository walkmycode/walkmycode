# WalkMyCode — one-page plan

*Draft 4, 30 Sep 2026 (draft 3 was 29 Sep; draft 4 adds monoliths and microservices, now built). Owner's decisions so far: name **WalkMyCode**; two versions from one codebase — **WalkMyCode Lite** (a
Claude artifact, AI on the viewer's own Claude plan) and **WalkMyCode** (a hosted web app sold on pay-per-use credits, with
self-hosting on your own keys kept as a mode); models not Anthropic-only, configured iReliabee's way; motion design
in the spirit of the @uxmiles reference videos; the Code room ("Try it") from Lecture Hall; the voice lecturer as a
Deepgram Voice Agent; order: provider layer + motion → Lite → voice lecturer + Code room → hosted credits.*

## Who it's for
**Vibe coders**: people who built an app with Cursor, Lovable, Bolt, v0 or Claude and now can't find their way
around it. They can run the app but can't answer "where does the login actually happen?" They don't know the
jargon, they get scared by big file trees, and they learn best when someone *shows* them.
Second group (later): bootcamp students and juniors joining a team.

**Where we stand against others:** DeepWiki writes docs, Greptile and Cody answer questions for engineers, and
Cursor explains a selection in the editor. None of them is **beginner-first, visual, spoken, and able to follow a
button all the way to the database table**. That's our gap.

## Core flows
1. **Connect**: pick one local folder or several (Chrome/Edge File System Access API, with an
   `<input webkitdirectory>` fallback for other browsers) or a GitHub repo (OAuth, read-only). Several folders make
   one workspace and one map; each folder's paths start with its name.
2. **See the map**: five lanes, left to right: *Pages & components → API routes → Logic/services → Database →
   Outside services*. Real arrows only, e.g. `Login button → POST /api/login → auth.ts → users table`. Each box
   gets a one-line plain-English label. A system of several services opens on the **system view** (one card per
   service, arrows between them with the code and config lines that prove them) and drills into each service's
   five lanes; one app opens straight on its lanes, as before.
3. **Highlight to explain**: select code and get "what this does, who calls it, what it calls, what data it
   touches", in a teaching tone, with links back to the lines it's talking about.
4. **Trace it**: from any box or selection, light up the whole path across the layers and step through it.
5. **Guided tour (voice)**: ask "how does checkout work?" and a narrated walkthrough plays, moving the code
   highlight and the map in sync. The user can interrupt by talking, ask a question, then carry on.
6. **Try it** (the Code room, from Lecture Hall — decided 29 Sep):
   beside any explained code, run a function with sample inputs or step through it: an editor, a
   record-and-replay debugger (breakpoints, step forward *and back*, variables with changes highlighted, the call
   stack, "Explain this step"), and "explain the error / give me a hint". See "Code room" below.

## Architecture
- **One Next.js (App Router) + TypeScript codebase, two builds.** The map is drawn with React Flow and the code
  viewer is CodeMirror 6 (read-only, chalk theme). The parser, map, viewer, inspector, walkthrough UI and prompts
  are shared; a thin **adapter layer** (below) is the only thing that differs between Lite and full.
- **Analyzer**: TypeScript, tree-sitter WASM, runs **in the browser tab** (Web Worker next) for local folders and
  in Node for the CLI indexer and tests. It outputs one `map.json` (nodes, edges, evidence). Same code everywhere.
- **Full app server** (Next.js route handlers): the AI proxy (multi-provider, below), a Deepgram token minter,
  GitHub OAuth, and — in hosted mode — accounts and the credit ledger. **Code is never stored**: the map and file
  index live in the browser (IndexedDB), and only the snippets a question needs are sent to the AI. The AI's tools
  (`read_file`, `search`, `query_map`, …) execute in the browser; the server only forwards.
- **Models, not Anthropic-only**: a `PROVIDERS` catalogue in iReliabee's style (id, env var, models with plain
  descriptions, default, base URL): Anthropic (default, `claude-opus-5-5`), OpenAI, Google Gemini, Groq, DeepSeek,
  xAI, and any OpenAI-compatible local server (Ollama, LM Studio). Anthropic is called natively; the others go
  through one translator (Anthropic wire format ↔ OpenAI chat format, tool calls included, streaming included),
  as iReliabee's website proxy does. A settings screen picks provider + model and takes keys; keys are written by
  the server to a local gitignored file, never held in the browser; a readiness check says what's missing.
  *Spec: `docs/PROVIDERS.md`; motion in `docs/MOTION.md`.*
- **Two modes of the full app**: **hosted** (the owner's keys, users buy credits — iReliabee's ledger pattern:
  hold → settle at actual cost × markup) and **self-hosted / BYOK** (clone, put keys in `.env.local` or the settings
  screen, run `npm run dev`; no accounts, no ledger). Same code, `WALKMYCODE_MODE=hosted|byok`. Open-source licence to
  confirm with the owner (MIT suggested) — it is what makes BYOK possible and is a marketing asset for the hosted one.

## Three more requirements (owner, 30 Sep)
1. **Monoliths and microservices alike.** A repo may be one app, a monorepo of packages, or many services (each
   its own repo) talking over HTTP, gRPC or queues. The analyzer must find *service boundaries* (docker-compose /
   Kubernetes service names used as hostnames, env-var base URLs such as `USERS_SERVICE_URL`, OpenAPI specs, `.proto`
   files, broker topics/queues, gateway rewrites) and the map must offer a **system view** (service → service, with
   the same evidence rules) that drills into each service's five lanes. Several folders/repos can be connected into
   one workspace. *Spec and status: `docs/SERVICES.md` — built on the `services` branch (all fourteen tasks,
   tests green); iReliabee reads as three services with every earlier link kept.*
2. **Every panel docks, undocks and resizes.** Map, Code, Guide, Details, Files, Code room and Settings are panels
   in a dockable layout (drag to re-arrange, split, tab, float, pop out into its own browser window, drag the
   dividers), and the arrangement is remembered. *Spec: `docs/SHELL.md`.*
3. **Users register.** The full app has accounts (sign-up / sign-in), which is what credits, saved workspaces and
   the privacy record hang off. Reuse iReliabee's email-code sign-in (accounts, auth_codes, refresh_tokens, Resend
   mail) rather than passwords; GitHub sign-in can come with GitHub OAuth. Lite uses the viewer's Claude identity
   (`user.id()`) and needs no registration. *Spec: `docs/ACCOUNTS.md`. Decided: sender `support@`, a GitHub App (not an OAuth App), Turso when hosted / a SQLite file when self-hosted.*

## One app, two rooms (owner's decision, 30 Sep)
- **Explore** (this plan): the map, explain, trace, tours, the voice lecturer.
- **Learn** (built by the other session on branch `feat/learn`, worktree `../lantern-learn`): Lecture Hall ported in —
  courses in any subject from beginner to mastery, chalkboard lessons, the spoken professor, raise-hand, quiz, marked
  explain-back, the Code room and debugger, a mastery roadmap per course, JavaScript and SQL beside Python.
- **Shared**: one professor persona, the Code room and debugger, the provider layer (Learn calls it read-only from its own
  `/api/learn` route: `resolve`, `readiness`, `keyFor`, `makeModel`, `friendly`, `guarded`), voice, accounts and credits,
  one progress record. Learn owns `src/app/learn/**`, `src/learn/**`, `src/app/api/learn/route.ts`, `public/py/**`,
  `tests/learn*.test.ts`; Explore owns the rest, including the shell, which gets the Learn/Explore switch.
- **Links**: Explore → Learn "Teach me this" via `teachHref({topic, file, start, end, snippet})` from `src/learn/links.ts`
  (`/learn?teach=…&from=path:start-end`); Learn → Explore "See it in a real codebase" via
  `/map?focus=<repo-relative path>[:<start>[-<end>]][#<symbol>]` or `/map?node=<map node id>` (opens the file at the
  lines, selects the owning card, and focuses the map on its neighbourhood).
- **One IDE for both rooms** (owner's decision, 30 Sep): Explore's code pane becomes the shared `src/ide/` editor
  (owned by the Learn session; a superset of CodeView with the chalk theme, edit mode with an "Unsaved" pill, Ctrl+S,
  Run/Debug for Python via MicroPython or laptop Python, the professor beside it). Explore keeps ownership of *writing*
  files through a `FileSource` adapter: local folders via FS Access `createWritable`; GitHub as a commit or PR on a
  branch, never straight to the default branch; Lite's file-input sources can't write back, so download or copy.

## Voice as a setting (owner's decision, 30 Sep)
Voice is configured like the AI models: a catalogue and a Settings choice, not a fixed provider.
- **Narration (text to speech):** ElevenLabs (default in the full app; Flash v2.5, ~75 ms, $0.04/1K chars, character
  timings for word sync; v4/v4 Turbo only through Text to Dialogue), Deepgram Aura-2 (~$0.030/1K), or the browser's
  built-in voice (free).
- **Listening + barge-in + function calling (the voice lecturer):** Deepgram Voice Agent by default: $0.075/min with
  Deepgram-managed Haiku 4.5 included (fast, the default), $0.163/min with managed Sonnet 5; the user's own Opus 5.5 is
  $0.059/min + tokens but needs a relay (phase 2, untested). ElevenAgents (~$0.08/min + LLM) is the alternative; Speech
  Engine is not (it needs a public WebSocket). Checked 1 Oct: Deepgram's agent can speak with an ElevenLabs voice on one
  connection, but the ElevenLabs key then rides inside the agent's Settings, so that also waits for the relay.
  The browser reaches Deepgram directly with a 30-second token our server mints: no relay in phase 1.
  **Owner's decision, 1 Oct: ElevenLabs' agent (ElevenAgents, Claude Haiku 4.5, the narration voice) is the default
  lecturer**, so one voice runs through tours and talk; Deepgram's agent is the cheaper choice. Both are built behind
  one session interface (phase 1 done, untested with real keys). Full spec: docs/VOICE.md.
- **Per version:** self-hosted = every option, on the user's own keys; hosted = every option, priced as credits per
  minute / per character; Lite = browser voice only and typed questions (artifacts block the microphone and outside
  network calls, so neither ElevenLabs nor Deepgram can be reached from inside Claude).
- Privacy: whichever voice provider is chosen is named in the privacy text (audio and narration text go to it).

## Two versions from one codebase
| | **WalkMyCode Lite** (Claude artifact) | **WalkMyCode** (hosted web app) |
|---|---|---|
| Who pays for AI | The viewer's own Claude plan (`claude.use("sample")`); nothing for the owner | The owner's keys, sold as credits (or the self-hoster's own keys) |
| Runs where | Inside claude.ai / the Claude app, as a published artifact | Its own site |
| Code sources | GitHub via the viewer's claude.ai GitHub connector (`mcp` capability); a local folder via `<input webkitdirectory>` or drag-and-drop; in the Claude desktop app optionally a local MCP host server | GitHub OAuth (read-only) and the File System Access API |
| AI loop | `sample(turns, {tools, onText})` — the page's own functions are the tools, so the same browser-executed tools work; no server | `/api/ai` proxy → provider layer with the same tools |
| Saved data | `claude.use("db")` under `data/users/<id>/…` (private per viewer) | Own backend (hosted) or IndexedDB only (BYOK) |
| Voice | Output only: browser `speechSynthesis` (British voice, as Lecture Hall); questions typed | **The voice lecturer**: a Deepgram Voice Agent (listen + think + Aura speak + function calling, barge-in built in) — see below |
| Try it (Code room) | MicroPython (ulab + `settrace`) in a Web Worker, entirely in the page | Same in-page engine, plus real Python on the laptop through a local MCP host server (Claude desktop app), as `lecture-hall/laptop-python` |
| Motion | Same components; reduced where the artifact frame is small | Full |
| Packaging | `next build` static export → `scripts-pack.mjs` (Lecture Hall's proven recipe): page as a fragment, fonts on a wrapper div, `_next/` → `app/` with every path rewritten, U+FFFD escaped, only allowed file types (`.wasm`, `.mjs` as text/javascript are fine; no archives), ≤255 files / 64 MB per version, grammars bundled — nothing fetched from outside at run time | Normal Next.js deployment |

**Lite's hard limits** (so nobody is surprised): no microphone, so questions are typed; no network except the
platform, so no Deepgram and no GitHub REST directly (only the viewer's connector); only Claude users, inside
Claude; `sample` has no memory, so each ask resends the conversation it needs; tool rounds bill the viewer's plan.

**Adapters** (`src/lib/adapters/*`; the rules are pure functions in `select.ts`, fed by the build target,
`NEXT_PUBLIC_WALKMYCODE_TARGET=lite|full`, and by what Claude's runtime offers the page, asked the Learn room's way):
- `ai`: inside Claude, `sample` with WalkMyCode's tools as page functions (`ai.ts`); in the app `/api/claude`; Lite
  outside Claude says asking needs Claude. Both return the same `AskResult` to the Guide.
- `storage`: IndexedDB always; inside Claude the map (with its file list) also goes to `db` at
  `data/users/<id>/workspace`, gzipped in chunks under 256 KiB. The code stays in IndexedDB.
- `source`: Lite reads a folder from `<input webkitdirectory>` or a drop and saves by offering the file through
  Claude's download prompt (or copying it); the app keeps FS Access and the indexed repos.
- `settings`: Lite has no provider or key form and no cost meter. `voice`: Lite reads tour steps aloud with
  `speechSynthesis` and never listens.

**Building Lite**: `npm run build:lite` (a static export where only `*.lite.tsx` files are routes, so no API route is
built and `page.lite.tsx` holds every room), then `npm run pack:lite [folder]` (default `publish-lite/`): the page
as a fragment plus `files.json`, ready for the artifact publisher (about 180 files, 16 MB). The artifact declares
`sample`, `db`, `user` and `downloads`.

**Order**: (1) provider layer + motion (designs in flight), (2) Lite packaging + adapters, proving the map and
walkthroughs on other people's repos at no cost to the owner, (3) full-app voice, then (4) hosted accounts + credits.

## How the map is built (the parser decides the links, the AI only labels them)
1. **Parse** every source file with tree-sitter (WASM grammars for TS/JS/TSX, Python, Dart, PHP) to get imports, exports,
   functions, JSX elements and Flutter widgets, and call sites. The Dart grammar is built from source and kept in
   `vendor/tree-sitter-dart` (its README says where it came from); PHP's is npm's `tree-sitter-php` (the full grammar,
   so Blade views and HTML around `<?php` parse).
2. **Framework extractors** turn syntax into architecture:
   - *Routes*: Next.js `app/**/route.ts` + `pages/api`, Express `app.get/post`, FastAPI `@router.get(...)` +
     `include_router` prefixes.
   - *Calls to routes*: `fetch`/`axios`/generated clients with literal or template URLs → matched to route
     patterns (`/api/users/${id}` ↔ `/api/users/[id]`). In Flutter, Dio and package:http calls; a relative
     `api.get('/x')` goes to the one base URL the package's Dio clients are given (`String.fromEnvironment`).
   - *Screens*: go_router `GoRoute(path:, builder:)` labels the screen widget's card with its path; screens are
     not API routes.
   - *Data*: Prisma schema + `prisma.user.findMany`, Supabase `.from('users')`, SQLAlchemy models, raw SQL
     strings (`SELECT … FROM users`), sqflite, Hive boxes and Firestore collections → table nodes.
   - *Outside services*: known SDK imports and hosts (Stripe, Supabase, OpenAI, Anthropic, Deepgram, Resend…).
   - *Services*: `docker-compose.yml`, Kubernetes, Dockerfiles, `.env.example`, `next.config` rewrites, proxies,
     nginx, OpenAPI/AsyncAPI, `.proto`, broker topics and workspace manifests decide which folders are separate
     services and which hostname or setting (`USERS_URL`) points at which one (`docs/SERVICES.md`). Config files
     are read in the browser like code; `.env` and `.env.local` never are, and example values that look like
     secrets are hidden.
3. **Every edge carries evidence** (file + line). Each edge is *certain* (resolved exactly), *likely* (for example
   a URL built from a variable, matched by pattern) or never drawn at all. Likely edges show dashed and say
   "our best guess". **No evidence means no arrow**, because a wrong arrow teaches a beginner something false.
4. **AI labels**: Claude Haiku 4.5 writes a ≤12-word label and a 2-sentence summary per file/route/table from its
   code + neighbours (batched, cached by file hash). Labels never create edges.

## The ask / voice loop
- **Understanding**: Claude Opus 5.5 (`claude-opus-5-5`, effort `medium`) with tools: `read_file(path, lines)`,
  `search(text)`, `query_map(node|path)`, `trace(from, to)`. The system prompt + tool list + map summary are
  prompt-cached. Answers must cite `file:line`; the UI turns citations into highlights.
- **Tour**: Claude returns a script as structured JSON, `steps: [{say, file, lines, nodeIds}]`. Each step's `say`
  goes to **Deepgram Aura-2** TTS, and the UI highlights the step's lines and nodes while it plays (step-level sync
  in the MVP, word-level later).
- **Listening / the voice lecturer** (full WalkMyCode only; decided 29 Sep): instead of wiring STT and TTS ourselves, the lecturer is a **Deepgram Voice Agent** (the API iReliabee
  already uses for its voice mock interview: `wss://agent.deepgram.com/v1/agent/converse`, relayed by our server so
  the key never reaches the browser). It bundles listening (Nova-3), a thinking model (can be Claude), Aura speech
  and **function calling**, with barge-in built in. Its system prompt is the lecturer persona (Lecture Hall's
  professor: plain English, patient). Its functions drive the UI: `highlight_lines`, `open_file`,
  `focus_map_node`, `trace_path`, `next_step`, `run_code`, plus the read tools (`read_file`, `search`, `query_map`)
  so answers stay grounded. It is billed per minute ($0.075/min standard, plus the thinking model's tokens), so hosted mode charges **credits per minute** with a hold at the
  start of each session, as iReliabee does for live sessions. Lite stays typed with `speechSynthesis`, because
  artifacts block the microphone and outside network calls. *Fallback if the agent's function calling proves too
  limited for tours*: the earlier design — Nova-3 STT + our own Claude tool loop + Aura TTS.
- **Secret guard**: `.env*`, key files and strings that look like keys are never sent to any AI, and the map
  shows them as "🔒 secret file".

## Code room: "Try it" beside any explanation (decided 29 Sep)
Lecture Hall already has the parts, and they are proven inside an artifact: `src/components/CodePanel.tsx` (the
editor + run), `src/components/DebugPanel.tsx` (stepping through a recorded run, forwards and backwards, variables
with what just changed, the call stack, output so far, jumping between breakpoints, with the professor to explain
any step), `public/py/debugger.py` (the shared `sys.settrace` tracer that records the run for both engines) and
`public/py/runner.mjs` (MicroPython with ulab and settrace in a Web Worker, so a runaway program never freezes the
page). Two engines: **in the page** (MicroPython — works in Lite too) and **on the laptop** (real Python through the
local MCP host server in `lecture-hall/laptop-python`, Claude desktop app only). For WalkMyCode: when the guide explains
a Python function, "Try it" copies it into the Code room with sample inputs the guide suggests; the user runs it,
steps through it, and asks "why did this change?". JavaScript/TypeScript functions come later (a QuickJS or
in-page JS sandbox), so the MVP of the room is Python-only. Copy the components in (read, don't import across
repos), restyled only where WalkMyCode's layout needs it.

## Fly-through (owner, 1 Oct; build after the Settings redesign and MCP phase B)
Type or say where to go ("show me how checkout reaches the database", "take me to the login page") and the map
travels there live.
- **A "go to" bar** on the map (⌘/Ctrl+K, and a mic button where voice is on). Plain names (a page, a route, a table)
  resolve instantly in the browser from the map index, with no AI. "How/why" questions go to the AI with the map
  tools, and it may only answer with **real edges** (ids from the map). A path with a gap is shown as a gap, never
  invented.
- **Motion, in step with the answer**: the camera glides (pan + zoom, eased, ~400 ms, scaled by `--m`) to each
  card in turn; "the light" travels along each real arrow; cards light up hop by hop; the code panel opens at the
  cited lines; the narrator reads each hop's line. Each step plays as soon as its tool result streams in, not after
  the whole answer.
- **Controls**: pause/next/back, Esc to stop, "replay"; the finished path stays drawn and can become a tour.
- **Everywhere**: full app (provider layer), WalkMyCode for Claude (Claude calls `focus_node` / `trace_path` and the
  page animates the same way), Lite (the viewer's Claude through `sample`).
- **Speed budget**: the first camera move starts within 100 ms of a name match; motion off = instant jumps.
- **Built (1 Oct)**: the go-to bar is the Ctrl+K palette grown (`src/components/Palette.tsx`): a name flies at once,
  "A to B" flies the real arrows between two cards (both with no AI), a question goes to the guide with `fly_step`
  (one call per hop, checked against the map in `src/lib/flyPath.ts`: an unknown node or a made-up arrow is refused,
  a skipped hop is refused with the real hops named, a real gap is shown dashed and said). The player and the one API
  for other code (`flyTo`, `play`, `path`, `between`, the controls, `saveAsTour`) are `src/lib/flythrough.ts`; the
  bar over the map is `src/components/FlyBar.tsx`; the mic is the browser's speech recognition (`src/lib/listen.ts`,
  the app only). Measured: Enter → the camera's first move 41 ms (was 298 ms), docs/PERFORMANCE.md.

## More languages for the map (owner, 1 Oct)
Today the map reads JavaScript/TypeScript, Python and Dart/Flutter (plus SQL, Prisma and config files). Next, in this
order, each one build: a tree-sitter grammar (as Dart's, built for web-tree-sitter 0.27 if npm has none that loads), an
extractor, and its popular frameworks' routes, calls and data:
1. **Go**: net/http, chi, gin, echo, fiber; database/sql, sqlx, gorm; net/http clients.
2. **Rust**: axum, actix-web, rocket; sqlx, diesel, sea-orm; reqwest.
3. **Java/Kotlin**: Spring (MVC, WebFlux), Ktor; JPA/Hibernate, JDBC; RestTemplate, WebClient, OkHttp.
4. **PHP**: Laravel, Symfony; Eloquent, Doctrine; Guzzle. Laravel is in (extract/php.ts): routes/web.php and api.php
   (closures, controller methods, resources, groups), Eloquent models and migrations as tables (with their columns),
   Blade and Inertia pages, Blade forms and links to routes (by route name or path, @method), Livewire components
   (their views, `<livewire:x />`, full-page routes, wire:click), Http:: requests. Symfony too: #[Route] attributes,
   Doctrine entities (table, columns) and repositories, Twig templates and their path() links. Next: config/routes.yaml,
   Doctrine relations as arrows between tables, a Guzzle client's base_uri.
5. **C#**: ASP.NET Core (controllers, minimal APIs); Entity Framework, Dapper; HttpClient.
Same rules as every language: an arrow only with file:line evidence, guesses dashed; fixtures and tests per framework;
the iReliabee and ahofe maps must stay byte-identical. Running code in any language already works through the local
terminal ("Run on: This computer").

## Licence
GNU AGPL-3.0 (`AGPL-3.0-only`): open source, with no closed hosted clones.

## Privacy (policy live before the hosted launch; README + first screen for BYOK and Lite)
The policy names every provider that can see code. The snippets a question needs, and the question, go to exactly one
model provider — the one picked in Settings, on the user's own key: **Anthropic (Claude)** (the default; no training
on API traffic), **OpenAI** (sent with `store:false`, so nothing is retained), **Google Gemini** (free-tier traffic may
be used to improve Google products), **Groq**, **xAI (Grok)** (sent with `store:false`), **DeepSeek**, or a **local
server** (Ollama, LM Studio) where nothing leaves the machine. **DeepSeek processes data on servers in China and its
terms allow training on inputs**; Settings says so as soon as DeepSeek is picked, and the connect screen lists it.
**Deepgram** gets voice audio and narration text, which can include code names. It says the map stays in the browser,
code is never stored on our servers, GitHub access is read-only and revocable, secret files are never sent, and what
each provider retains (checked against their current terms at launch; the one-line summaries above are the
`privacy` sentences in `src/lib/providers/catalogue.ts`, which Settings shows). Lite adds: the AI runs on the viewer's
own Claude plan and saved data sits in their private artifact space.

## MVP (2–3 weeks, one stack end to end)
- **Week 1**: analyzer (TS/TSX + Python, React + FastAPI + Next.js route handlers, fetch↔route matching, raw
  SQL/SQLite + Prisma tables) and the map UI. First run on **iReliabee** (React/Tauri → FastAPI → SQLite, plus
  the Node website).
- **Week 2**: code viewer, highlight-to-explain, Trace it, and one scripted text tour, all with Claude + tools.
- **Week 3**: voice (Aura narration, Nova-3 questions, barge-in), a session cost meter, local-folder picker
  polish, and a README with setup + privacy.
- **Out of the MVP**: GitHub OAuth (it comes right after), Express/SQLAlchemy extractors, team sharing, and
  editing code.
- **Status on 29 Sep**: weeks 1–2 are done in prototype form and running against iReliabee (277 routes, 60 tables,
  1,787 links, 65 traced to the UI element that fires them). Next: provider layer + motion, then Lite, then voice.
- **Status on 30 Sep**: owner requirement 1 (monoliths and microservices) is built on the `services` branch per
  `docs/SERVICES.md`: map version 2, service boundaries from config, requests resolved across services, the system
  view with drill-in, workspaces of several repos, and the AI told which service it is in. iReliabee now reads as
  three services (frontend, backend, ireliabee-web) with 1,809 links and every one of the earlier 1,787 kept. Not
  yet done: the 20-question provider run on the compose fixture (needs a real key). Requirements 2 (docking) and 3
  (accounts) are specified in `docs/SHELL.md` and `docs/ACCOUNTS.md`.

## Risks
- **Wrong or missing arrows** from dynamic URLs, base-URL env vars, monorepos or codegen. *Mitigation*: the
  evidence/confidence model, a "why is this arrow here?" button, and a hand-checked test set of edges from 3 real
  repos.
- **Surprise bills** on the user's own keys. *Mitigation*: a visible cost meter, caching, a cap on tokens per
  question, and a confirmation before indexing a big repo, with its estimate shown.
- **Two targets drifting apart**: Lite and full must share components or Lite rots. *Mitigation*: the adapter
  layer is the only allowed difference; CI builds both targets; Lite's packaging script lives in this repo.
- **Provider quality**: cheaper models may cite wrong lines or mishandle strict tool schemas. *Mitigation*: the
  citation checker (every `path:line` must exist), a per-provider "best effort" label in settings, and a recorded
  test set of 20 questions run across providers before a model is listed as recommended.
- **Hosted costs**: chatty users on Opus. *Mitigation*: holds before every call, cached prefixes, caps per
  question, and credits priced over the worst case.
- **Browser limits**: File System Access is Chrome/Edge only (other browsers get the fallback, a read-only
  snapshot). Very large repos can be slow to parse in the browser, so we'd cap files and ignore
  `node_modules`/build output.
- **Beginner trust**: a confident wrong explanation does real harm. So every claim cites lines, and "I'm not sure"
  is an allowed answer.
- **Crowded market**: we win only if beginner-first + visual + voice feels clearly different in the first 60
  seconds.
