# Provider stream fixtures

**Every file here is synthetic.** They were written by hand on 2026-09-30 from the wire shapes documented in `docs/PROVIDERS.md` §4 and the research notes (vendor docs read on 2026-09-29), and checked against the parsers in the pinned `@ai-sdk/*` packages. None of them is a recording of a real API call: no keys were used, and the ids, signatures and encrypted blobs are made up.

`tests/translate.test.ts` replays them through `/api/claude` (the real handler and `src/lib/providers/sdk.ts`) with a fake `fetch`, so they pin how the SDK reads each vendor's stream and what it sends back on the next turn.

| folder | wire | files |
|---|---|---|
| `anthropic/` | Messages API SSE | `text` · `thinking-fallback-tool` (fallback marker, thinking + signature, tool input split across deltas) · `parallel-tools` |
| `openai/` | Responses API SSE | `text` (cached input) · `reasoning-tool` (reasoning item with encrypted content, arguments split across deltas) · `incomplete` (`incomplete_details.reason: max_output_tokens`) |
| `xai/` | Responses API SSE | `text` · `reasoning-tool` (function call arrives whole, encrypted reasoning) · `no-usage` (stream cut before `response.completed`) |
| `gemini/` | `streamGenerateContent?alt=sse` | `text` (cached content, thought tokens) · `signed-tool` (`thoughtSignature`) · `parallel-tools` |
| `groq/` | Chat Completions SSE | `text` (reasoning, usage under `x_groq.usage`) · `split-tool` |
| `deepseek/` | Chat Completions SSE | `reasoning-tool` (`reasoning_content`, usage-only final chunk with `prompt_cache_hit_tokens`) · `length` |
| `local/` | OpenAI-compatible SSE | `text` (usage-only final chunk) · `parallel-tools` · `no-usage` |

## Replacing them with recordings

Task 13 in `docs/PROVIDERS.md` §7 is where real streams get recorded, alongside `npm run smoke -- --provider <id>` (the smoke script checks a provider but does not save its streams; capture the raw response body separately). When a real recording exists, save it here under the same name (keys, account ids and repo text scrubbed), mark that file as recorded (with the date) in the table above, and run `npm test`. A test that fails on a real recording means the synthetic fixture was wrong, not the code: fix the fixture's expectations in `tests/translate.test.ts` only after reading the SDK's parser for that event.

## Voice fixtures (`voice/`)

Also synthetic, written on 2026-10-01 from the shapes in `docs/VOICE.md` and the vendors' docs read that day; no key was used and every id, token and byte is made up. `tests/voice.routes.test.ts` replays them through the voice routes with a fake `fetch`, and `tests/voice.agent.test.ts` replays the agent script through an in-process fake WebSocket server.

| file | stands for |
|---|---|
| `tts.mp3` | three silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz): what a narrator streams back |
| `with-timestamps.ndjson`, `with-timestamps.text.txt` | ElevenLabs `stream/with-timestamps`: two chunks of `{audio_base64, alignment, normalized_alignment}` for the sentence in the text file, character times running on from chunk to chunk |
| `grant.json` | Deepgram `POST /v1/auth/grant`: `{access_token, expires_in: 30}` |
| `voices.json` | ElevenLabs `GET /v1/voices`, with an "Eldrin" voice second |
| `agent-script.json` | Deepgram's side of one agent session, in order: Welcome, (Settings expected), SettingsApplied, ConversationText, AgentStartedSpeaking, 24 kHz linear16 audio, AgentAudioDone, UserStartedSpeaking, FunctionCallRequest (two calls), (a FunctionCallResponse expected), FunctionCallCancelled, barge-in during audio, Error |
