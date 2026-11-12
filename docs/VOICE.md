# Voice: narration and the voice lecturer

*1 Oct 2026. Implements PLAN.md "Voice as a setting". Facts checked against the vendors' docs on 1 Oct 2026 (research
notes with every source: Deepgram voice-agent reference and pricing, ElevenLabs models/pricing/streaming, Anthropic
models). Anything marked **untested** needs one session with a real key before it is offered. Phase 1 is built (§9);
owner's decision the same day: **ElevenLabs is the default lecturer too**, so one voice runs through tours and talk.*

## 1. What the user gets
- **Narration**: tours speak each step while the step's lines and cards light up; any answer has "Read aloud".
- **The voice lecturer** (full app only): "Talk" opens a live voice session. You ask out loud, it answers out loud, you
  can interrupt it (barge-in), and while it talks it drives the screen: highlights lines, opens files, focuses cards,
  traces paths, steps a tour, runs code in the Code room. Its answers stay grounded through the same read tools the
  typed guide uses.
- Voice is a **setting**, like the AI model: a catalogue, a choice, a price beside each option and a privacy line naming
  where audio and text go.

## 2. The catalogue (`src/lib/voice/catalogue.ts`, browser-safe)
Narrators (text to speech):

| id | Model / voice | Latency | Price | Notes |
|---|---|---|---|---|
| `elevenlabs` (default, full app) | `eleven_flash_v2_5`, voice "Eldrin" (British baritone, the official replacement for George) | ~75 ms | $0.04 / 1K chars | Confirm the voice id with `GET /v1/voices` at setup and fall back to the account's first voice. Default voices end 31 Dec 2026. Character timings available (`/stream/with-timestamps`) for word-level sync. |
| `deepgram` | Aura-2 `aura-2-draco-en` (British, male); `aura-2-pandora-en` (British, female) | streamed | $0.030 / 1K chars | ≤ 2,000 chars per request: split by sentence. No word timings: step-level sync. |
| `browser` (default in Lite) | `speechSynthesis`, a British voice when present (as Lecture Hall) | instant | free | Works everywhere, no key. |

Lecturers (listen + think + speak + functions + barge-in):

| id | Think model | Price | Phase |
|---|---|---|---|
| `elevenagents` (default since 1 Oct) | ElevenAgents with `claude-haiku-4-5` (fast; not Opus, voice latency matters), speaking in the narration voice (Eldrin by default) | $0.08 / min + the model's tokens | 1 |
| `deepgram-agent` · Fast (the cheaper choice) | Deepgram-managed `claude-haiku-4-5`, fallback chain → `claude-sonnet-5` | $0.075 / min (Standard; the LLM is included) | 1 |
| `deepgram-agent` · Smarter | Deepgram-managed `claude-sonnet-5` | $0.163 / min (Advanced) | 1 |
| `deepgram-agent` · Your Claude | `claude-opus-5-5` / `claude-sonnet-5-5` on the user's Anthropic key | $0.059 / min + tokens | 2, **untested** |

Speech to text (`STTS`; Settings → Voice → "Speech to text", saved as `voice.stt`): how a spoken question becomes
text where no lecturer listens (Talk through Claude on WalkMyCode for Claude's page, hands-free or held; in the app the
lecturer hears you itself). Prices are pay-as-you-go, read from each vendor's own pages on 2 Oct 2026.

| id | Model | Price | Key | Privacy |
|---|---|---|---|---|
| `browser` (default) | the browser's `SpeechRecognition` (en-GB), words as you speak | free | none | Chrome and Edge recognise on Google's or Microsoft's servers |
| `groq-turbo` | Groq `whisper-large-v3-turbo` (fast, cheapest) | $0.04 / hour, each clip billed as ≥ 10 s | `GROQ_API_KEY` (the model providers' key) | No inference data kept by default (abuse logs ≤ 30 days; Zero Data Retention in Groq's Data Controls) |
| `groq-large` | Groq `whisper-large-v3` (most accurate) | $0.111 / hour, each clip billed as ≥ 10 s | `GROQ_API_KEY` | as above |
| `deepgram` | Deepgram pre-recorded `nova-3`, smart formatting | $0.0043 / min ($0.258 / hour) | `DEEPGRAM_API_KEY` | sent with `mip_opt_out` |
| `elevenlabs` | ElevenLabs `scribe_v2` (batch) | $0.22 / hour (plans include hours) | `ELEVENLABS_API_KEY` | to ElevenLabs on your key |

The chosen transcriber is used when its key is set, even where the browser could hear; without its key the browser
hears, and where the browser can't, the first key set (Groq turbo, Deepgram, ElevenLabs); else the question box takes
the focus. Free voice uses the browser alone. Groq: `POST https://api.groq.com/openai/v1/audio/transcriptions`
(multipart `file`, `model`, `language: en`, `response_format: json`; `Authorization: Bearer`), files up to 25 MB on the
free tier (100 MB on Dev); WalkMyCode caps a clip at 6 MB. Failures become a `FriendlyError`: bad key (401/403), rate
limit (429, and Groq's 498 flex capacity), file too large (413 or a "too large" body), retired model (404).

Why Haiku by default: speed is the product's first rule and a voice reply must start fast; Haiku 4.5 is the fastest
Claude, and the fallback chain keeps sessions working if Deepgram retires it (not before 15 Oct 2026). Opus 5.5 and
Sonnet 5.5 are not managed by Deepgram; using them means our key inside the agent's Settings (phase 2, below).

The Deepgram lecturer speaks with a Deepgram voice in phase 1 (`flux-colin-en`, British). An ElevenLabs voice inside
Deepgram's agent needs the ElevenLabs key inside Settings, so it waits for the relay (phase 2). The ElevenLabs lecturer
(§4b) speaks in the narration voice with no relay: its key stays on the server, which hands the page a signed link.

## 3. Keys, config, routes
- Keys stay server-side in `.walkmycode/keys.env` (`DEEPGRAM_API_KEY`, add `ELEVENLABS_API_KEY`), entered in Settings
  exactly like provider keys; never sent to the browser, never logged.
- Choice in `.walkmycode/config.json` under `voice: {narrator, voiceId?, speed?, lecturer, lecturerModel, input?, headphones?, stt?}`
  (`src/lib/voice/config.ts`, with readiness like `providers/config.ts`).
- Routes, all behind the loopback + same-origin guard (`guarded()`), `runtime = "nodejs"`:
  - `POST /api/voice/speak` `{text, stepId?}` → streams `audio/mpeg` from the chosen narrator (ElevenLabs
    `/v1/text-to-speech/{voice}/stream?output_format=mp3_44100_128`, or Deepgram `/v1/speak?model=…&encoding=mp3`).
    `?timestamps=1` (ElevenLabs only) → NDJSON `{audio_base64, alignment}` chunks for word sync.
  - `POST /api/voice/token` → a Deepgram grant (`POST /v1/auth/grant`, `ttl_seconds: 30`): `{access_token, expires_in}`.
    The JWT only needs to be valid at the handshake; the open socket outlives it.
  - `GET /api/voice/settings` → the agent `Settings` JSON built on the server (`src/lib/voice/agentSettings.ts`), so
    the browser never composes cost- or destination-setting fields. The browser adds only what it alone has: the
    map's summary to the prompt (capped here too) and the repo's names as keyterms.
  - `POST /api/voice/elevenagents/session` `{map_summary}` → `{signed_url, agent_id, overrides}`. On first use it makes
    WalkMyCode's 11 client tools (`POST /v1/convai/tools`) and a private agent (`POST /v1/convai/agents/create`:
    `enable_auth`, `claude-haiku-4-5`, the tools, the narration voice, overrides allowed for prompt, voice and ASR
    keywords) and keeps their ids in `config.json`; later it reads the agent (`GET /v1/convai/agents/{id}`) and sends
    the prompt and voice as per-session overrides when the agent allows them, else `PATCH`es the agent when the map
    or voice changed; then `GET /v1/convai/conversation/get-signed-url` (valid 15 minutes).
  - `POST /api/voice/transcribe` `{vendor: "groq"|"deepgram"|"elevenlabs", model?, audio_base64, mime}` → `{text}`:
    one recorded question through the speech-to-text choice (§2), in the app and on WalkMyCode for Claude's page.
  - `GET`/`POST /api/voice/config` (the saved choice, `has_key` per voice key and the Groq key, readiness) and `GET /api/voice/voices`
    (the ElevenLabs account's voices, Eldrin marked). Voice keys go through `POST /api/config/key` like the others.
- Privacy text names the chosen providers: audio and spoken text go to Deepgram; narration text to ElevenLabs or
  Deepgram. `mip_opt_out: true` on every Deepgram call (no model-improvement use).

## 4. The lecturer, phase 1 (no relay)
1. Browser asks `/api/voice/token` and `/api/voice/settings`, opens
   `wss://agent.deepgram.com/v1/agent/converse` with subprotocols `["bearer", jwt]`, sends `Settings` first, waits for
   `SettingsApplied`, then streams the mic (linear16, 16 kHz) and plays the agent (linear16, 24 kHz, `container:"none"`)
   through an AudioWorklet.
2. `Settings`: `listen` Flux (`flux-general-en`, `keyterms` = the repo's top file/function names), `think` as chosen
   (**no `temperature`**: Claude 4.7+ rejects it), prompt = lecturer persona + map summary (≤ 25,000 chars), the
   functions below **without `endpoint`** (so they run in the browser), `speak` Flux `flux-colin-en`, a greeting.
3. Functions (client-side): `highlight_lines{path,from,to}`, `open_file{path,line?}`, `focus_map_node{id}`,
   `trace_path{from,to}`, `next_step{}`, `run_code{}` (with `defer_until_eot: true`), and the read tools
   `read_file`, `search`, `query_map`, served by the same runner the typed guide uses (`lib/claude/tools.ts`).
   Answer each `FunctionCallRequest` with `FunctionCallResponse {id, name, content}`; drop ids named in
   `FunctionCallCancelled` (speculative calls since Sep 2026).
4. Barge-in: on `UserStartedSpeaking` stop playback and discard buffered agent audio at once.
5. Captions from `ConversationText`; `AgentThinking` shows "thinking"; errors through `FriendlyError`.
6. Billing is by connected time: `KeepAlive` every 8 s only while muted, close after 60 s idle and on leaving the
   room, show minutes × price in the cost meter.
7. The mic needs a secure context: localhost counts. Lite has no mic and no outside network: typed + `browser` voice.

## 4b. The ElevenLabs lecturer, and what both share (owner, 1 Oct)
1. Behind one `LecturerSession` (`src/lib/voice/lecturer/session.ts`): connect, push-to-talk or hands-free, events
   (`caption`, `thinking`, `speaking`, `listening`, `mic`, `functionCall`, `cancelled`, `error`, `close`), close. The UI
   never knows which lecturer it talks to.
2. ElevenLabs: the server's signed link, then `Conversation.startSession({signedUrl, connectionType:"websocket",
   clientTools, overrides})` from `@elevenlabs/client` 1.26.0 (pinned; loaded only when this lecturer starts). The SDK
   owns the microphone (echo cancellation and noise suppression on), playback, barge-in and keep-alive; muted, it
   sends silence. `deep_answer` carries `pre_tool_speech: "force"` and a 120 s timeout.
3. One dispatcher (`lecturer/tools.ts`) answers both: the room's actions, the read tools, and two additions:
   `deep_answer{question}` (the typed guide's own loop on the Language model choice, Opus 5.5 by default, lighting the
   lines it cites as they arrive; the lecturer says one short line first, and on Deepgram an `InjectAgentMessage`
   covers a wait over 6 s) and `continue_tour{}` (carry on the narration paused for a question).
4. **Hands-free by default** (owner, 2 Oct; §4c): tap Talk once and speak. "Hold to talk" is the option in Settings →
   Voice. Speaking (or holding) during a tour pauses the narration and gives the lecturer the step (file, lines, words)
   as a context note (`UpdatePrompt` on Deepgram, room kept for it; `sendContextualUpdate` on ElevenLabs); afterwards
   it offers to carry on.
5. Tours: the next step's audio is fetched while one plays; audio is cached by hash(narrator, voice, speed, text) in
   memory and IndexedDB, per map name and `generatedAt`, so a replay costs nothing and a re-index starts afresh.

## 4c. Hands-free conversation (owner, 2 Oct)
One model for every way WalkMyCode talks, full app and WalkMyCode for Claude's page alike
(`src/lib/voice/handsfree/conversation.ts`, pure): tap Talk once to start, tap again, Esc or "Tap to end" to end. Each
utterance is one turn; nobody holds a key. Lite has no microphone: Talk stays hidden there.
- **End of speech**: the lecturers stream the microphone the whole time and use their own turn detection: Deepgram
  Flux with `eot_threshold: 0.7` (0.5–1.0, its default) and `eot_timeout_ms: 3000` (default 5000; shorter so a turn
  never hangs), no eager end-of-turn (Deepgram "Configure the Voice Agent", checked 2 Oct 2026); ElevenAgents with its
  own turn detection, `turn.turn_eagerness: "normal"` set on the agent it makes (ElevenLabs "conversation flow",
  checked 2 Oct 2026). Talk through Claude and Free voice use a VAD (`handsfree/vad.ts`): 20 ms RMS frames from the
  `lantern-mic` worklet, a noise floor learnt from the room (the first 200 ms, then fast down / slow up), speech at 3.5×
  the floor, an utterance ending after 800 ms of quiet, under 250 ms dropped. With browser recognition each utterance
  is what the recognizer heard up to that pause (or its final result if the VAD heard nothing); with a transcriber
  chosen under Speech to text (§2), or no browser recognition, the utterance's audio, with 300 ms from before it
  began, goes as WAV to `/api/voice/transcribe` on the user's key (Groq, Deepgram or ElevenLabs).
- **Barge-in**: speech while WalkMyCode speaks stops the voice and audio at once and listens. The microphone always has
  echoCancellation, noiseSuppression and autoGainControl. On speakers (the default) our own voice is not heard as the
  user: Deepgram gets silent frames while the lecturer speaks (as iReliabee's mock interview does) and ElevenAgents'
  microphone is muted; the page watches the real level meanwhile and only energy well above the learnt echo (2.5×,
  held 160 ms) cuts in, then the real microphone flows again (with 300 ms of pre-roll on Deepgram). In Talk through
  Claude what the recognizer heard while the narration played is dropped unless the user cut in. "I'm using
  headphones" (Settings → Voice) sends the real microphone at all times, for the best barge-in.
- **The pill** (`components/voice/TalkPill.tsx`): Listening / Thinking / Speaking / Paused / Still there?, a ring that
  follows the microphone's level (a CSS variable, no re-render), a red recording dot whenever the microphone is open,
  mute, "Tap to end", the words as they are heard; motion scaled by `--m`; the state is a polite live region.
- **Cost and privacy**: 45 s of quiet brings a gentle "Still there?", 60 s ends the conversation; the microphone is
  released whenever it ends (every track stopped, the AudioContext closed).
- Settings → Voice → "How Talk listens": Hands-free (default) or Hold to talk (noisy rooms: hold Space or Talk, let go
  to send), and "I'm using headphones"; saved in `config.json` `voice.input` / `voice.headphones`.

## 4d. Speech to text on this computer: Parakeet (11 Nov)
A free, private choice under Settings → Voice → Speech to text, next to the browser and the transcribers on a key:
"On this computer (Parakeet)". The audio never leaves the computer. English only. Design taken from iReliabee.
- **Model**: NVIDIA Parakeet-TDT 0.6B v2, the int8 sherpa-onnx conversion (`encoder.int8.onnx`, `decoder.int8.onnx`,
  `joiner.int8.onnx`, `tokens.txt`; about 630 MB; CC-BY-4.0). `parakeet/model.ts`: a copy iReliabee already has
  (`~/.local/share/ireliabee/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`) is used where it lies when all four
  files are there and not empty, and is never changed or removed. Otherwise WalkMyCode downloads its own into
  `~/.walkmycode/models/` from the sherpa-onnx release: streamed to a `.part` file with progress and cancel, after a
  free-space check (archive + files + 150 MB); the size (482,468,385 bytes) and SHA-256 are checked before anything is
  unpacked; `parakeet/tar.ts` takes out only the four files and refuses the whole archive for an absolute path, a `..`
  segment, a symbolic link or a hard link; the folder is moved into place in one rename. "Remove" deletes
  WalkMyCode's own copy only.
- **Engine** (`parakeet/engine.ts`): the npm package `sherpa-onnx-node` (Apache-2.0), `OfflineRecognizer` with
  `modelType: "nemo_transducer"`, CPU, `numThreads = max(1, min(4, cores - 1))`. Loaded lazily, once per server process
  (about 3 s), preloaded when the pointer or the keyboard reaches a mic button (Talk, or the Learn professor's mic)
  with Parakeet chosen, and at the press if neither did: never with the page, since it holds about 700 MB of memory;
  decodes run one at a time. It is a native module: kept out of the client bundle and out of Next's server
  bundle (`serverExternalPackages`) and external to the MCP server's bundle, where it loads from `node_modules` when it
  is there. The packaged MCP server (npm, .mcpb) does not carry it yet: Settings says so there, and Talk falls back.
- **Audio path**: `getUserMedia` → the `lantern-mic` AudioWorklet (16 kHz mono, 20 ms frames) → `parakeet/client.ts`
  posts about 0.2 s at a time, one post after another, to `POST /api/voice/parakeet/stream` (16-bit PCM as base64 in
  JSON; float32 from there on). Each answer carries the events since the last: `speech`, `partial`, `decoding`,
  `final`, `discard`, `notice`, `error`. It is a run of small posts and not a socket so that every piece passes the
  same guard as any local route (`guarded()`: loopback, same origin, JSON); a hosted WalkMyCode refuses. Nothing is
  written to disk.
- **Behaviour** (`parakeet/detect.ts`, `previews.ts`, `session.ts`, all pure but for the engine):
  speech is a 20 ms frame whose RMS is above 2.5× the room's learnt noise floor and never under 0.0015; an utterance
  starts after 0.15 s of it and ends after 1.2 s of silence; under 0.4 s of voiced audio it is skipped; past 60 s it
  ends at the next pause (0.3 s), and at 75 s whatever is being said. While speaking, the last 8 s are decoded again
  every 1.0 s as a live preview (from 0.8 s of voice; a tick is skipped while the last preview is still running); two
  previews slower than 70% of the interval turn previews off for that talk, with the reason shown. Stop, or letting go
  in hold to talk, drains and decodes what is left (0.15 s of voice is enough then), so a short dictation is not lost.
- **English only**: when the browser's language is not English, or the model is not there yet, the choice made before
  Parakeet (`voice.sttBefore`) hears instead, and Talk says so.
- **Where it is used**: Talk through Claude and Free voice on WalkMyCode for Claude's page (the hands-free Ear streams
  every frame while speech counts; the VAD there still watches for a barge-in over our own voice and holds the echo
  back), and the Learn professor's mic button in every build with a server. The app's own Talk is the lecturer, which
  hears the microphone itself.
- **Routes**: `GET /api/voice/parakeet` (where the model and engine stand), `POST /api/voice/parakeet` (`install`,
  `cancel`, `remove`, `preload`), `POST /api/voice/parakeet/stream`. Mounted by the app and by the MCP page's server.
- **Tests** (`tests/voice.parakeet*.test.ts`): the detector and endpointing on synthetic audio, the preview scheduler,
  the download verifier and safe extraction on small made-up archives, the settings state, the stream client and the
  Ear; and, when the model is on the machine, the model's own test recording through the stream route.

## 5. Phase 2 (only when needed)
A sidecar relay (`scripts/voice-relay.ts`, `ws` on 127.0.0.1:3010, started with `next dev` by `scripts/dev.mjs`; a
port of iReliabee's relay) for: the user's own Claude as the thinker, an ElevenLabs voice inside the agent, and hosted
credits (hold at session start, close code when credits run out). It fills the secret headers into `think.endpoint` /
`speak.endpoint`, strips any client-sent `endpoint`, allowlists client message types after Settings, checks `Origin`
plus a 30-second one-time ticket HMAC'd with a per-launch secret. Prove Opus 5.5 through Deepgram on a real key first
(always-on thinking, no temperature; latency "moderate").

## 6. Where voice appears
- Explore: tour player (play/pause/next, auto-advance on audio end, step highlight while speaking; word highlight
  when the narrator gives timings), "Read aloud" on answers, the "Talk" button for the lecturer.
- Learn: its professor uses the same narrator setting via `src/lib/voice` (the Learn session wires it); its mic
  button hears on this computer when Parakeet is chosen (§4d), else with the browser's recognition.
- Settings: a Voice section — narrator + voice + speed, lecturer + model, speech to text (each option with its price
  and privacy line; Groq's key row shown when it is missing), keys, prices, privacy line, a "Test voice" button.
  Settings → Privacy has a "Speech to text" row (the app, and WalkMyCode for Claude's page), and one for speech to
  text on this computer (nothing leaves). "On this computer (Parakeet)" shows where the model stands, a download with
  progress and cancel, "already on this computer" for iReliabee's copy, Remove for WalkMyCode's own, and the model's
  credit line.

## 7. Tests without keys
Synthetic fixtures in `tests/fixtures/voice/`: an agent event script (Welcome → SettingsApplied → ConversationText →
FunctionCallRequest → FunctionCallCancelled → UserStartedSpeaking → binary audio → AgentAudioDone → Error) replayed by
an in-process fake WebSocket server; a grant response; MP3 bytes; with-timestamps chunks. Cover: the session reducer,
a Settings snapshot per catalogue choice (no temperature, no endpoints, no secrets), function dispatch + cancellation,
routes via a fake `fetch` (the key never appears in a response or log), character → word timing, sentence splitting
for Aura's 2,000-char limit, the cost meter.

## 8. Risks
- Billing by connection time: idle sessions cost money; close aggressively.
- Speculative function calls: UI actions must be cheap to undo or deferred (`run_code`).
- Haiku 4.5 retirement (≥ 15 Oct 2026): covered by the fallback chain; revisit the default when Deepgram adds a newer
  managed Haiku.
- ElevenLabs default voices end 31 Dec 2026; the v4 promo ends 12 Oct; Deepgram documents only `eleven_turbo_v2_5`
  (deprecated) and `eleven_v3` for its agent.
- Any website can open a WebSocket to localhost: the phase-2 relay must check Origin and a ticket.

## 9. Status (1 Oct): phase 1 built
- **Code**: `src/lib/voice/` (catalogue, config, errors, speech, agentSettings, routes, view, narrate, audioCache,
  tourBus, speakAloud) and `lecturer/` (session, functions, tools, worklets, audio, `deepgram/` protocol + reducer +
  session, elevenagents, index); `src/components/voice/` (TourPlayer, ReadAloud, Talk, LecturePanel, VoiceSettings);
  routes under `src/app/api/voice/`. All voice code loads on first use; the map's page gains about 12 KB, and
  scripts/perf.mjs, run alternately against the base build (6 runs each), shows no slower first paint or click.
  Lite's build leaves the lecturer out altogether (no LiveKit, no worklets): 183 files, 15.8 MB packed.
  The Learn room can read aloud with the same choice through `speakAloud()` (`src/lib/voice/speakAloud.ts`).
- **Tested without keys**: `tests/voice*.test.ts` (fixtures in `tests/fixtures/voice/`, all synthetic): catalogue,
  config and readiness, the routes through a fake `fetch` (the key never in a response, header or log line), Settings
  per model, the reducer, the Deepgram session against an in-process fake agent replaying the script, dispatch and
  cancellation, the worklets' own source in a VM, the ElevenLabs session with a fake SDK, narration and its cache.
  In a headless browser with the vendors mocked: a narrated tour (word lit, auto-advance, prefetch, free replay),
  read aloud, Talk on Deepgram's protocol (Settings first, no audio before SettingsApplied, a function call driving
  the code panel, Space to talk).
- **Untested until a real key**: everything that crosses to a vendor. ElevenLabs: Flash v2.5 streaming, the
  with-timestamps framing and clock, `voice_settings.speed`, GET /v1/voices and Eldrin's presence, the agent and tool
  APIs (create, read, PATCH merge, overrides, `pre_tool_speech`), the signed link, the SDK session (tools, overrides,
  mute while held), its pricing. Deepgram: Aura-2 `speed` and `mip_opt_out` on `/v1/speak`, the grant, the bearer
  subprotocol handshake, Settings acceptance (the think fallback array with a full think per element, Flux listen and
  speak, keyterms), the event order, `defer_until_eot`, cancellation, UpdatePrompt and InjectAgentMessage, the
  KeepAlive cadence, barge-in timing. Microphones and speakers on real hardware, and Safari.
- **run_code** answers "not available yet": the Code room has no public API to run its code from Explore.
