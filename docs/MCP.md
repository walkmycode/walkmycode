# The WalkMyCode MCP server (any MCP client: Claude, Antigravity, Cursor…)

*1 Oct 2026. Owner's decision: this is the **public, free version for everyone**; the Lite artifact stays private,
for the owner only. The user's own Claude (Claude Desktop, Claude Code, or any MCP client) is the brain; WalkMyCode is
the map, the code view, the tours and the voice. Items marked **verify** must be checked against current docs before
they are relied on; **test** needs one live run.*

## 1. What the user gets
Install once, then say "open WalkMyCode on ~/code/myapp" in Claude (or run `/walkmycode` in Claude Code). WalkMyCode's page
opens in the browser on the user's own machine, the map draws, and from then on:
- **Claude drives the page**: while it explains, the cards light up, files open at the right lines, traces draw.
- **The page drives Claude**: clicking Explain, Trace it or Tour on the page, typing a question there, or holding
  Space and speaking, sends the request to Claude, which answers on the page and out loud.
- **Any repo**: local folders read directly from disk (no browser sandbox, no artifact size limit), big monorepos,
  several repos as one workspace, real Python for "Try it".
- **Source control on the page**: the top bar's branch button commits, pushes, pulls, discards, switches branches,
  shows history and settles conflicts in the workspace's repo, through the user's own git and GitHub sign-in
  (`src/lib/localrun/git.ts`, over the same local-run socket and consent as the terminal).
- **No API key needed.** Every answer runs on the user's own Claude subscription, because the user runs Claude
  themselves; WalkMyCode never sees or reuses their Claude credentials (Anthropic's terms forbid that without approval).

## 2. How it is built
One process, started by the MCP client (`npx -y <package>`, stdio):
1. **MCP server** (stdio, `@modelcontextprotocol/sdk`) exposing the tools of section 3 and server `instructions` that
   teach Claude the loop. *Verified 1 Oct 2026*: `@modelcontextprotocol/sdk` 1.31.0 (latest, MIT, `McpServer.registerTool`
   with zod 4 schemas) is pinned. The SDK's v2 also exists as split packages (`@modelcontextprotocol/server` 2.2.0), a
   later move.
2. **Local web server** on `127.0.0.1` (a free port, the last one when it can) serving WalkMyCode's front-end, built as a third static target
   `NEXT_PUBLIC_WALKMYCODE_TARGET=mcp` (same code as Lite, served from the root), plus a WebSocket **bridge** to the page.
3. **Workspace on disk**: folders read with Node's fs and mapped with the same analyzer the CLI uses
   (`scripts/index.ts`), maps and answers saved under `~/.walkmycode/` (keys in `~/.walkmycode/keys.env`, never in a
   response or log).
4. **Small local routes** for what needs a key the user chose to add: ElevenLabs speech, the ElevenAgents signed URL,
   the Deepgram token (the same server modules as the full app's `/api/voice/*`, bundled).

The bridge carries two directions: **requests** from the page to Claude (queued until Claude asks for the next one)
and **commands** from Claude to the page (highlight, focus, narrate…), each acknowledged by the page.

### Terminal mode: no AI app at all
The same server also runs on its own, started by a person with a folder (`mcp/src/cli.ts` picks the mode,
`mcp/src/terminal.ts` runs it):

```bash
node mcp/dist/server.mjs .                    # this folder; once published: npx walkmycode-mcp .
node mcp/dist/server.mjs open ~/code/my-app   # `open` is optional; several folders make one workspace, --name names it
node mcp/dist/server.mjs --help               # also --version
```

- The folders are mapped exactly as `walkmycode_open` maps them (same `openWorkspace`, same limits), the page server
  starts, and a short banner prints what is mapped and the page's URL with this launch's token; the browser opens it
  (never under `WALKMYCODE_NO_BROWSER=1`). Ctrl+C (or SIGTERM) closes the page server and stops any local runs.
- No MCP transport runs and no client connects, so the bridge's status says `standalone: true` instead of naming a
  client. Every request the page makes is answered by the page itself, at once: no 3.5 s wait for a poll and no
  sampling (`answerRoute` in `src/lib/bridge/fallback.ts`). The page uses the AI key in Settings → AI model (or
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`… in the environment); with none it says "Add an AI key in
  Settings → AI model to ask questions here" with an Open settings button, never "isn't listening". The status pill
  says "Answering here with <provider>".
- With no arguments it stays the MCP server when stdin is a pipe (how every AI app starts it); run bare in a terminal
  (stdin a TTY) it prints the help instead of waiting for MCP messages. The `WALKMYCODE_*` variables work the same.

## 3. Tools Claude gets
Loop:
- `walkmycode_open(path | paths[])` — map the folder(s), open the page (or return its URL), return a short map summary
  and how to continue.
- `next_request(wait_s = 50)` — wait for the next thing the user did on the page: `{id, kind: explain | trace | tour |
  question | spoken | deep, payload, context}` (context = the file, lines, card or tour step on screen). Returns
  `{kind: "none"}` after `wait_s`, and Claude calls it again. **This is how page buttons and speech reach Claude.**
- `answer(id, markdown, citations[])` — show the answer in the Guide panel; citations (`path:line-line`) light up.
- `narrate(text, id?)` — speak a short chunk now (the page queues chunks in order). Claude is told to narrate in
  sentences as it goes, so the first words play before the whole answer is written.

Driving the page: `focus_node(id | path)`, `open_file(path, line?)`, `highlight_lines(path, from, to)`,
`trace_path(from, to)`, `start_tour(steps[{say, file, lines, nodeIds}])`, `tour_step(n)`, `show_view(system | all |
service)`.

Reading, so answers stay grounded (the same runner as the typed guide): `query_map(node | path)`,
`read_file(path, from?, to?)`, `search(text)`, `list_files(glob?)`.

Every tool returns plain text a model can use; errors say what to do next.

## 4. Voice: every mode, chosen in the page's Settings
| Mode | Needs | Speed | What happens |
|---|---|---|---|
| **Tours** | nothing (browser voice) or an ElevenLabs key | **instant** | `start_tour` hands the page every step; the page prepares each step's audio ahead (next step while the current one plays), cached per repo version; replays free |
| **Talk through Claude** (default) | nothing | **~2–6 s per reply** (Claude's own thinking; faster on Sonnet/Haiku, slower on Opus) | Hands-free (docs/VOICE.md §4c): tap Talk once and speak; each pause (~0.8 s, a VAD) ends an utterance → the page turns it into text (browser speech recognition, or Deepgram/ElevenLabs with a key) → one `spoken` request → Claude answers with `narrate` chunks + UI tools; speak over the narration to stop it. The moment an utterance is sent, the page says a short local line ("let me look…") and lights the cards your words name, so the wait never feels empty. Hold to talk is the option in Settings → Voice |
| **Lightning lecturer** | an ElevenLabs key | **~1 s per reply**, interrupt any time | The page runs ElevenLabs' live agent (signed URL minted by the local server with the user's key; fast model; the same client tools). A hard question goes to Claude through `deep_answer` → a `deep` request → Claude's grounded answer comes back as the tool result and the agent speaks it |
| **Free voice** | nothing | instant | Browser voice for narration, browser speech recognition for questions |

Narration voice: ElevenLabs by default when a key is present (owner's choice), else the browser's British voice.

## 5. Install
- **Claude Code**: `claude mcp add walkmycode -- npx -y <package>`, plus a Claude Code plugin with a `/walkmycode` skill
  that opens the page and starts the loop.
- **Claude Desktop**: a one-click Desktop Extension bundle (`.mcpb`, manifest 0.3: *verified 1 Oct 2026*, see §8 B),
  or the JSON config entry.
- **Other MCP clients** (Cursor, VS Code…): the same server works; answers then run on that client's model.
- **No AI app**: `npx walkmycode-mcp <folder>` once published (`node mcp/dist/server.mjs <folder>` from this repo)
  runs it in terminal mode (§2), answering with the user's own key from Settings → AI model.
- **claude.ai on the web** can only use remote connectors: that is the hosted/Teams path, later.
- The package name depends on the trademark check. Publishing to npm is outward-facing:
  only with the owner's yes.

## 6. Safety
- The web server binds `127.0.0.1` only, on the last launch's port when it is free (`~/.walkmycode/page-port`, so the
  browser's own storage, like the tour audio cache, carries over), else a random one; the token never carries over:
  the page URL carries a per-launch token that becomes a
  cookie; every HTTP request checks `Host` (DNS-rebinding) and every WebSocket checks `Origin` + the token. No other
  site or local process can drive the page or read the repo through it.
- Read-only by default: Claude can't write files through WalkMyCode; the page's own Save writes only after the user
  presses it (the FileSource rule). In phase B the page's Save offers the file (copy or download) and never writes
  into the folder. The page server takes a POST or DELETE only on its own few routes (the user's answers, the talk
  mode, a voice key, the voice calls), only with the cookie, from the page's own `Origin`, as JSON, within a size
  limit (§8 B).
- `.env` files, key files and key-like strings are never sent to Claude (the existing secret guard); evidence lines
  are redacted as everywhere else.
- Keys the user adds live in `~/.walkmycode/keys.env`, are sent only to their own provider, never to the page.
- Source control writes to the repo only on the user's click (commit, discard after a confirm, switch, resolve,
  pull, push). The page can only name files git itself lists as changed; every argument goes to `git` as argv
  (no shell), a commit message is passed as `--message=…` so it is never read as an option, and push and pull never
  wait on a typed password (`GIT_TERMINAL_PROMPT=0`). No GitHub token is stored.

## 7. Limits to test
- **Verified 1 Oct 2026** (code.claude.com/docs/en/mcp and /docs/en/env-vars; `@modelcontextprotocol/sdk` 1.31.0):
  - Claude Code gives **stdio servers no per-request timer**; the wall-clock limit is `MCP_TOOL_TIMEOUT`, default
    100,000,000 ms (about 28 hours), or a per-server `timeout` in `.mcp.json`. The 60-second first-byte timer is
    only for HTTP, SSE and claude.ai connector servers.
  - An idle call (no response and no progress notification) aborts after 30 minutes on stdio
    (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, v2.1.187+).
  - **A main-conversation call still running after 2 minutes moves to a background task**
    (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` = 120000, v2.1.212+): the real ceiling for one `next_request`.
  - Server startup may take 30 s (`MCP_TIMEOUT`).
  - Tool results warn above 10,000 tokens and stop at 25,000 (`MAX_MCP_OUTPUT_TOKENS`).
  - Each tool description and the server instructions are cut at 2,048 characters.
  - Claude Code defers MCP tools behind tool search, so only the tool names and the instructions load at start.
  - MCP SDK clients time a request out after 60 s (`DEFAULT_REQUEST_TIMEOUT_MSEC`) unless the client sets its own.
    Claude Desktop's limit is not documented.
- **So**: `next_request` waits 50 s by default (`wait_s` up to 110). That stays under an SDK client's 60 s and under
  Claude Code's 2-minute move to the background. Tool results are cut at 36,000 characters (about 9,000 tokens). The
  instructions are 1,504 characters, loop first.
- **When the loop ends**: `next_request` tells Claude to stop (`{"kind":"none","stop":true}`) when the page has been
  closed for 5 minutes, or unused for 20 minutes, which saves the user's usage. The next call after "continue" listens
  again. The page sees `status.listening` turn false and says plainly, naming the client from the MCP handshake
  (`clientInfo`, src/lib/bridge/clientName.ts): "Antigravity isn't listening: ask it to continue".
- **Any MCP client, and how long its loop lasts** (src/lib/bridge/fallback.ts): loop endurance differs by client.
  Claude Code keeps calling `next_request` for as long as it is asked to; Antigravity (Gemini) ends its turn after a
  task and never polls again. So a page request waits for the loop only while the loop is live (a `next_request`
  waiting, one in the last 5 s, or a request still being worked on). After about 3.5 s with no poll it falls back,
  in this order:
  1. **MCP sampling**, when the client declared the `sampling` capability: the server asks the client's model
     (`createMessage`) with the map summary, what is on screen and the code the request points at pre-loaded and
     bounded (sampling has no tools), and shows the answer through the same `narrate`/`answer` path.
  2. **The page's own key** (Settings → AI model, the full app's provider layer run by the local server:
     `/api/config`, `/api/claude`): the page answers itself and withdraws the request from the queue.
  3. **A plain word**: "Antigravity isn't listening. Ask it to "keep listening to WalkMyCode", or add a key in
     Settings → AI model to chat here.", with a Settings button. The request stays queued, so the client still
     answers it if it comes back.
- **test**: how long Claude Desktop keeps a tool loop going in one turn, and its per-call timeout.
- **test**: whether tool search's lookup before the first loop tools is slow enough to matter. If it is,
  `"anthropic/alwaysLoad": true` in the `_meta` of `next_request`, `answer` and `narrate` keeps them loaded, at some
  context cost.
- **test**: browser speech recognition quality and which browsers have it; fall back to typed questions.
- Speed is bounded by the user's Claude: the page cannot make Claude think faster, so it fills the wait (§4).

## 8. Order of work
- **A (now, server side)**: the MCP server, the request queue and bridge protocol, the tools of §3 against a test
  page, the local web server with §6 safety, workspace on disk, the build that bundles server + front-end into one
  package (not published), tests with the SDK's in-memory client and a fake page.
  *Built 1 Oct.*
  - The code is in `mcp/src` (`server.ts`, `tools.ts`, `bridge.ts`, `web.ts`, `workspace.ts`, `secrets.ts`) and
    `src/lib/bridge/protocol.ts`, the shared protocol that phase B imports.
  - `npm run build:mcp` makes `mcp/dist/server.mjs`, with the wasm and the page in `ui/` (phase A: the test page,
    still in `mcp/test-page` for the tests; since phase B: the `mcp` front-end target); run it with
    `node mcp/dist/server.mjs`. `npm run smoke:mcp` (`node mcp/smoke.mjs`) runs it over stdio.
  - Settings: `WALKMYCODE_UI_DIR` serves another page folder, `WALKMYCODE_HOME` moves `~/.walkmycode`, and
    `WALKMYCODE_NO_BROWSER=1` never opens a browser.
  - Maps and answers are saved in `~/.walkmycode/workspaces/<name>-<hash>/`.
  - Every tool result passes a secret guard: the machine's own keys, key shapes, private-key blocks and URL
    passwords are hidden.
- **B (after voice phase 1 merges)**: the `mcp` front-end target and its adapters (AI = the bridge, storage = the
  local server, source = server-read folders), the voice modes of §4 reusing voice phase 1's narrator, tour player
  and `LecturerSession`, the Claude Code plugin + `/walkmycode` skill, the Desktop Extension bundle.
  *Built 1 Oct.*
  - **The page** is the third build target, `NEXT_PUBLIC_WALKMYCODE_TARGET=mcp` (`src/lib/adapters/target.ts`):
    `npm run build:mcp-ui` exports `*.mcp.tsx` (`src/app/page.mcp.tsx`, `layout.mcp.tsx`) to `out-mcp/` (Next takes
    `distDir` as the export folder; Lite's `out/` is left alone). It is the app's own Explore room in one page
    (rooms switched in the page, as in Lite); before Claude opens a folder it shows "Ask Claude: Open WalkMyCode on
    <folder>" with a copy button (`src/components/mcp/McpStart.tsx`), and "Choose folder…" (the server opens the
    system's own folder dialog, `mcp/src/pickFolder.ts`: a browser never gives a page a folder's path) with "Open
    it here" (`POST /api/folder/open`, mapped as `walkmycode_open` would). With a project open it also offers
    "Back to the map". The Learn room is not part of it (no room switch on this page). The code view's Save writes
    the file back through `POST /api/files/save` (`writeWorkspaceFile`): only files it read, inside the folder,
    never a config file with hidden values, never over a change made on disk since. `npm run sweep:mcp` clicks
    every control of this page in headless Chrome and runs in CI.
  - **Adapters** (`src/lib/adapters/select.ts`): AI = `"bridge"` (`bridgeAi.ts`): Explain, Trace it (which still
    lights the path at once), Tour and typed questions become bridge requests carrying what is on screen
    (`RequestContext`), Claude's narration shows on the board while the answer comes, and the `answer` naming the
    request is the Guide's answer; an answer no request waited for (a question asked in Claude's chat) shows as
    "From Claude". Storage = `"server"` (`serverStorage.ts`): the workspace and code over `GET /api/workspace` and
    `/api/files`, the user's answers over `POST /api/answers` (saved in `answers.json`, the map made again with them
    so Claude's tools see the same arrows). Source = server-read folders. Settings → AI model says the answers come
    from the user's own Claude, the one that opened the page; there is no provider form, no AI pill and no cost meter.
  - **The page's bridge** (`src/lib/bridge/client.ts`, one per page in `page.ts`): `hello`, every command acked
    (the handler's note, its error, or "the map isn't open yet"), `activity` at most every 20 s, requests followed
    from sent to queued, taken and answered (or dropped/refused/cancelled), reconnects with back-off. Claude's status
    is a pill in the top bar and a line on the board: "Waiting for Claude… if nothing happens, say 'continue' in
    Claude" when a request waits and Claude is not polling. `replaced` (or a server of another protocol) covers the
    page with a plain notice. Claude's page commands run on the room's own actions (`src/lib/bridge/commands.ts`,
    `BridgeDriver.tsx`); an answer to a question asked during a tour ends the tour so the answer shows, while the
    answer that comes with the tour leaves it playing.
  - **Voice, all four modes**, chosen at the top of Settings → Voice, "When you hold Space and ask"
    (`src/components/mcp/TalkModeSettings.tsx`, saved in `~/.walkmycode/mcp.json`): **Tours**: `start_tour`
    plays by itself through phase 1's TourPlayer (gapless, cached per map; the server takes the last launch's port
    again when it is free, so the browser's audio cache carries over). **Talk through Claude** (default): hold Space
    or Talk; the browser's speech recognition (en-GB) where there is one, else the user's Deepgram (`nova-3`) or
    ElevenLabs (`scribe_v2`) key through `POST /api/voice/transcribe`, else the question box takes the focus; the
    words go as a `spoken` request; at once the page says a line of its own ("Let me look at sign-in.") and lights
    the cards the words name (`src/lib/voice/heard.ts`); Claude's `narrate` chunks play in order
    (`src/lib/voice/queue.ts`, next chunk fetched ahead). **Lightning lecturer**: phase 1's `LecturePanel` with the
    ElevenAgents session; the signed link is minted by the MCP server with the key in `~/.walkmycode/keys.env`;
    `deep_answer` becomes a `deep` request and Claude's answer goes back as the tool result (its narration is not
    read by the page). **Free voice**: browser recognition and the browser's voice for everything.
  - **Local routes** (`mcp/src/routes.ts`): `POST /api/answers`, `GET/POST /api/mcp/settings`, `POST/DELETE
    /api/config/key` (the two voice keys only, saved to `~/.walkmycode/keys.env`, only `has_key` comes back), and the
    full app's voice handlers (`src/lib/voice/routes.ts`, bundled): config, voices, speak, token, settings, the
    ElevenAgents session, transcribe. A POST or DELETE needs the cookie, the page's own `Origin`, `application/json`
    and a size limit (2 MB; 10 MB for transcribe); each handler also runs in `guarded()`. Anything else that is not
    GET or HEAD is still refused with 405.
  - **Bundles** (formats *verified 1 Oct 2026* against code.claude.com/docs/en/plugins-reference and
    github.com/modelcontextprotocol/mcpb; the installed Claude Code 2.1.105's `claude plugin validate` passes both
    the plugin and the marketplace, and refuses `$schema` and `displayName` in plugin.json, so they are left out):
    - `mcp/plugin`: `.claude-plugin/plugin.json`, `.mcp.json` (`node ${CLAUDE_PLUGIN_ROOT}/server/server.mjs`) and
      `skills/walkmycode/SKILL.md` (`/walkmycode [folder]`: `walkmycode_open` on the current folder, then the loop; it
      pre-allows the WalkMyCode tools by their plugin names, `mcp__plugin_walkmycode_walkmycode__*`). `npm run build:mcp`
      copies it with the server inside to `mcp/dist/plugin`, and writes a one-plugin marketplace,
      `mcp/dist/.claude-plugin/marketplace.json` (`walkmycode-local`).
    - `mcp/mcpb/manifest.json` (manifest 0.3, `server.type: node`, `${__dirname}/server/server.mjs`, every tool
      named): `npm run pack:mcpb` checks it with `@anthropic-ai/mcpb` 2.1.2's own schema and packs
      `mcp/dist/walkmycode.mcpb`.
  - **Sizes** (1 Oct): `server.mjs` 2.6 MB, the page 11.2 MB (MicroPython, sql.js and the grammars are most of it),
    the plugin folder 18.6 MB, `walkmycode.mcpb` 4.2 MB.
  - **Install by hand** (nothing is installed for anyone): Claude Code, `claude --plugin-dir <repo>/mcp/dist/plugin`
    for one session, or `claude plugin marketplace add <repo>/mcp/dist` then `claude plugin install
    walkmycode@walkmycode-local`, then `/walkmycode`; without the plugin, `claude mcp add walkmycode -- node
    <repo>/mcp/dist/server.mjs`. Claude Desktop: open `mcp/dist/walkmycode.mcpb` (or Settings → Extensions → Advanced
    settings → Install Extension…).
  - **Tested**: `tests/mcp.page.test.ts` (the client with a fake socket, the AI adapter with a fake bridge, every
    page command on a real map, spoken and deep requests, the narration queue, the instant line, hearing),
    `tests/mcp.routes.test.ts` (cookie, Origin, JSON and size checks; keys never in a response, header or log; the
    voice routes against fake vendors; answers), `tests/mcp.bundles.test.ts` (the mcpb manifest against the official
    schema, the plugin, the skill). `npm run e2e:mcp` runs the real bundle over stdio and the real page in headless
    Chrome (Playwright, its own browser, a random port): a click on Explain arrives through `next_request`, narrate
    is read by a stubbed `speechSynthesis`, `highlight_lines` and `answer` show, a typed question, a tour that plays
    itself, push to talk with stubbed recognition, Settings (the AI pane, a talk mode saved through a real POST from
    the page), the listening pill, and another tab taking over.
  - **Untested** (needs the owner's machine and keys, phase C): a real Claude Desktop and Claude Code running the
    plugin or the extension (tool search, how long Desktop keeps the loop, `allowed-tools` with plugin tool names);
    real ElevenLabs and Deepgram calls for transcribe, narration and the Lightning lecturer from this page; a real
    microphone with the browser's recognition (Chrome sends audio to Google; Firefox has none, so it falls back to a
    key or typing); macOS and Linux.
- **C**: a live run in the owner's Claude Desktop and Claude Code (with their permission), then publish.
