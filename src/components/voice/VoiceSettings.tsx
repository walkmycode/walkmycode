"use client";
// Settings → Voice (docs/VOICE.md §6): who reads aloud and in which voice and
// at what speed, a "Test voice" button, who answers when you Talk (ElevenLabs
// by default, Deepgram the cheaper choice), how Talk listens (hands-free by
// default; hold to talk for noisy rooms; headphones), how speech becomes text
// (the browser, Groq Whisper, Deepgram Nova-3, ElevenLabs Scribe; voice.stt),
// the voice keys and Groq's when missing (entered like
// the model providers' keys, never sent back), and where audio and text go.
// In WalkMyCode Lite only the browser's voice exists, so only it is offered, and
// its choice stays in this browser. Laid out in the Settings view's boxes
// (src/components/settings/); loaded when the Voice pane is opened.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FACE_SIZES, faceOn, faceSize, setFaceOn, setFaceSize, subscribeFace, type FaceSize } from "@/learn/lib/face";
import { TARGET } from "@/lib/adapters/target";
import { parakeetUsable, type ParakeetStatus } from "@/lib/voice/parakeet/status";
import ParakeetPanel from "./ParakeetPanel";
import {
  builtModels,
  LECTURER_IDS,
  LECTURERS,
  lecturerPrice,
  NARRATOR_IDS,
  NARRATORS,
  narratorPrice,
  SPEED,
  STTS,
  sttPrice,
  VOICE_DEFAULT,
  voicePrivacy,
  type InputMode,
  type LecturerId,
  type LecturerModelId,
  type NarratorId,
  type SttId,
  type SttKeyEnv,
} from "@/lib/voice/catalogue";
import type { FriendlyError } from "@/lib/providers/wire";
import type { KeyStanding } from "@/lib/aiConfig";
import { announceVoiceSaved, loadVoiceView, saveLiteVoice, unlockAudio, type VoiceView } from "@/lib/voice/view";
import { BrowserNarrator, browserVoices, ServerNarrator, VoiceError, type Narrator } from "@/lib/voice/narrate";
import { Box, Cols, KeyLine, Status } from "../settings/parts";
import { whyFailed } from "@/lib/unreachable";

const LITE = TARGET === "lite";
const MCP_PAGE = TARGET === "mcp";

/** The speech-to-text choices as Settings shows them: Groq's two Whispers are one option with a model switch. */
const STT_OPTIONS: { id: SttId; label: string; price: string; env: SttKeyEnv | null; privacy: string }[] = [
  { id: "browser", label: "Browser", price: "free", env: null, privacy: STTS.browser.privacy },
  { id: "parakeet", label: STTS.parakeet.label, price: "free, private, English, ~630 MB", env: null, privacy: STTS.parakeet.privacy },
  { id: "groq-turbo", label: "Groq Whisper", price: `$${STTS["groq-turbo"].pricePerHour} – $${STTS["groq-large"].pricePerHour} / hour`, env: "GROQ_API_KEY", privacy: STTS["groq-turbo"].privacy },
  { id: "deepgram", label: STTS.deepgram.label, price: sttPrice(STTS.deepgram), env: "DEEPGRAM_API_KEY", privacy: STTS.deepgram.privacy },
  { id: "elevenlabs", label: STTS.elevenlabs.label, price: sttPrice(STTS.elevenlabs), env: "ELEVENLABS_API_KEY", privacy: STTS.elevenlabs.privacy },
];
const isGroq = (id: SttId) => id === "groq-turbo" || id === "groq-large";
const SAMPLE = "Hello. I'm the voice that reads WalkMyCode's tours aloud. This is how each step will sound.";

interface ElevenVoiceInfo {
  id: string;
  name: string;
  accent: string | null;
  gender: string | null;
}

async function bodyError(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { error?: string | FriendlyError };
    if (typeof b.error === "string") return b.error;
    if (b.error) return `${b.error.title}. ${b.error.message}`;
  } catch {
    // Not JSON.
  }
  return `The WalkMyCode server answered ${res.status}.`;
}

export default function VoiceSettings() {
  const [view, setView] = useState<VoiceView | null>(null);
  const [narrator, setNarrator] = useState<NarratorId>(LITE ? "browser" : VOICE_DEFAULT.narrator);
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState<number>(VOICE_DEFAULT.speed);
  const [lecturer, setLecturer] = useState<LecturerId>(VOICE_DEFAULT.lecturer);
  const [model, setModel] = useState<LecturerModelId>(LECTURERS[VOICE_DEFAULT.lecturer].defaultModel);
  const [input, setInput] = useState<InputMode>(VOICE_DEFAULT.input);
  const [headphones, setHeadphones] = useState(false);
  const face = useSyncExternalStore(subscribeFace, faceOn, () => true);
  const size = useSyncExternalStore(subscribeFace, faceSize, () => "medium" as FaceSize);
  const [stt, setStt] = useState<SttId>(VOICE_DEFAULT.stt);
  /** Whether the speech model is on this computer and can hear (told by its panel; before that, by the saved view). */
  const [onDevice, setOnDevice] = useState<boolean | null>(null);
  const onParakeet = useCallback((s: ParakeetStatus) => setOnDevice(parakeetUsable(s)), []);
  const [elevenVoices, setElevenVoices] = useState<{ voices: ElevenVoiceInfo[]; preferred: string | null; error: FriendlyError | null } | null>(null);
  const [browser, setBrowser] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Narrator | null>(null);

  const refresh = useCallback(
    (reset: boolean) =>
      loadVoiceView().then((v) => {
        setView(v);
        if (reset) {
          setNarrator(LITE ? "browser" : v.narrator);
          setVoiceId(v.voiceId ?? "");
          setSpeed(v.speed);
          setLecturer(v.lecturer);
          setModel(v.lecturerModel);
          setInput(v.input);
          setHeadphones(v.headphones);
          setStt(v.stt);
        }
        return v;
      }),
    [],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  // The browser's voices (British first), for its picker.
  useEffect(() => {
    let live = true;
    void browserVoices().then((v) => live && setBrowser(v));
    return () => {
      live = false;
    };
  }, []);

  // The ElevenLabs account's voices, once its key is set.
  const elevenKey = view?.keys.ELEVENLABS_API_KEY?.has_key ?? false;
  useEffect(() => {
    if (LITE || narrator !== "elevenlabs") return;
    let live = true;
    fetch("/api/voice/voices")
      .then((r) => r.json() as Promise<{ voices: ElevenVoiceInfo[]; preferred: string | null; error?: FriendlyError }>)
      .then((d) => live && setElevenVoices({ voices: d.voices ?? [], preferred: d.preferred ?? null, error: d.error ?? null }))
      .catch(() => live && setElevenVoices({ voices: [], preferred: null, error: null }));
    return () => {
      live = false;
    };
  }, [narrator, elevenKey]);

  // A test reading stops when the section closes.
  useEffect(() => () => testing?.stop(), [testing]);

  const n = NARRATORS[narrator];
  const lec = LECTURERS[lecturer];
  const models = useMemo(() => builtModels(lecturer), [lecturer]);
  const keyOf = (env: SttKeyEnv): KeyStanding | null => view?.keys[env] ?? null;
  const hasKey = (env: SttKeyEnv | null) => env === null || !!view?.keys[env]?.has_key;

  function pickNarrator(id: NarratorId) {
    setNarrator(id);
    setVoiceId(id === view?.narrator ? (view.voiceId ?? "") : (NARRATORS[id].defaultVoice ?? ""));
    setStatus(null);
  }

  function pickLecturer(id: LecturerId) {
    setLecturer(id);
    setModel(id === view?.lecturer ? view.lecturerModel : LECTURERS[id].defaultModel);
    setStatus(null);
  }

  async function test() {
    unlockAudio();
    testing?.stop();
    setStatus(null);
    const reader: Narrator = narrator === "browser" ? new BrowserNarrator({ voiceId: voiceId || null, speed }) : new ServerNarrator(narrator, { voiceId: voiceId || null, speed, trial: true });
    setTesting(reader);
    try {
      await reader.speak(SAMPLE);
    } catch (e) {
      setStatus({ ok: false, text: e instanceof VoiceError ? `${e.info.title}. ${e.info.message}` : "The test reading failed." });
    } finally {
      setTesting((t) => (t === reader ? null : t));
    }
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      if (LITE) {
        saveLiteVoice({ voiceId: voiceId || null, speed });
      } else {
        const res = await fetch("/api/voice/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ narrator, voice_id: voiceId, speed, lecturer, lecturer_model: model, input, headphones, stt }),
        });
        if (!res.ok) throw new Error(await bodyError(res));
        announceVoiceSaved();
      }
      await refresh(false);
      setStatus({ ok: true, text: "Voice saved" });
    } catch (e) {
      setStatus({ ok: false, text: `Save failed: ${whyFailed(e)}` });
    } finally {
      setSaving(false);
    }
  }

  const keyChanged = () => {
    announceVoiceSaved();
    void refresh(false);
  };

  if (!view) return <p className="sv-loading">Loading the voice settings…</p>;

  const narrators = LITE ? (["browser"] as NarratorId[]) : NARRATOR_IDS;
  return (
    <div className="voice-settings">
      <Cols>
        <div>
          <Box label="Reads tours and answers aloud">
            {!LITE && view.readiness.narrator && narrator === view.narrator && (
              <p className="sv-warn" role="status">
                <b>{view.readiness.narrator.title}.</b> {view.readiness.narrator.message}
              </p>
            )}
            <div className="sv-chips" role="radiogroup" aria-label="Narrator">
              {narrators.map((id) => {
                const d = NARRATORS[id];
                const ok = hasKey(d.env);
                return (
                  <button key={id} type="button" role="radio" aria-checked={narrator === id} className={`sv-chip${narrator === id ? " on" : ""}`} onClick={() => pickNarrator(id)} title={ok ? (d.env ? "Key set" : "No key needed") : "No key yet"}>
                    <span className={`mark ${ok ? "ok" : "bad"}`} aria-hidden>
                      {ok ? "✓" : "✕"}
                    </span>
                    {d.label}
                    <small>{narratorPrice(d)}</small>
                  </button>
                );
              })}
            </div>
            <p className="sv-hint">{n.hint}</p>
          </Box>

          <Box label="Voice">
            {narrator === "browser" ? (
              <select className="sv-select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="Browser voice">
                <option value="">{browser[0] ? `${browser[0].name} (the best British voice here)` : "The best British voice here"}</option>
                {browser.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} · {v.lang}
                  </option>
                ))}
              </select>
            ) : narrator === "deepgram" ? (
              <select className="sv-select" value={voiceId || n.defaultVoice || ""} onChange={(e) => setVoiceId(e.target.value)} aria-label="Deepgram voice">
                {n.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <select className="sv-select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="ElevenLabs voice">
                  <option value="" title="Eldrin when your account has it, else its first voice">
                    Eldrin, British baritone (default)
                  </option>
                  {voiceId && !elevenVoices?.voices.some((v) => v.id === voiceId) && <option value={voiceId}>{voiceId} (saved)</option>}
                  {elevenVoices?.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.accent ? ` · ${v.accent}` : ""}
                      {v.id === elevenVoices.preferred ? " · WalkMyCode's pick" : ""}
                    </option>
                  ))}
                </select>
                <p className="sv-hint">{elevenVoices?.error ? `${elevenVoices.error.title}: add your ElevenLabs key under Voice keys to list your voices.` : elevenVoices ? `${elevenVoices.voices.length} voices in your account.` : "Listing your voices…"}</p>
              </>
            )}
            <div className="sv-speed">
              <label htmlFor="voice-speed">Speed</label>
              <input id="voice-speed" className="speed" type="range" min={SPEED.min} max={SPEED.max} step={SPEED.step} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speaking speed" />
              <output>{speed.toFixed(2)}×</output>
            </div>
            <div className="sv-row">
              <button type="button" className="hbtn small" onClick={() => (testing ? testing.stop() : void test())}>
                {testing ? "■ Stop" : "▶ Test voice"}
              </button>
              <span className="sv-hint">{narrator === "browser" ? "Free." : `Reads one sentence (about ${SAMPLE.length} characters) on your key.`}</span>
            </div>
            <label className="sv-check">
              <input type="checkbox" checked={face} onChange={(e) => setFaceOn(e.target.checked)} data-testid="professor-face" /> Show the professor&apos;s face in Learn
            </label>
            {face && (
              <label className="sv-check" htmlFor="professor-size">
                Its size beside the board
                <select id="professor-size" className="field" value={size} onChange={(e) => setFaceSize(e.target.value as FaceSize)} data-testid="professor-size" style={{ width: "auto", marginLeft: 8 }}>
                  {FACE_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            )}
            <p className="sv-hint">A character whose mouth moves with the voice, beside the transcript under the board. It holds still when motion is off. In a lesson, <kbd>[</kbd> and <kbd>]</kbd> make it smaller or larger. Kept in this browser.</p>
          </Box>

          {!LITE && (
            <Box label="How Talk listens">
              <div className="sv-seg" role="radiogroup" aria-label="How Talk listens">
                <button type="button" role="radio" aria-checked={input === "hands-free"} className={input === "hands-free" ? "on" : undefined} onClick={() => setInput("hands-free")} data-testid="talk-input-hands-free">
                  Hands-free
                </button>
                <button type="button" role="radio" aria-checked={input === "push-to-talk"} className={input === "push-to-talk" ? "on" : undefined} onClick={() => setInput("push-to-talk")} data-testid="talk-input-hold">
                  Hold to talk
                </button>
              </div>
              <p className="sv-hint">
                {input === "hands-free"
                  ? "Tap Talk once and just speak; a pause of under a second ends your turn. Speak over the answer to stop it. Tap again or press Esc to end; it ends by itself after a minute of quiet."
                  : "For noisy rooms: hold Space or the Talk button while you speak, and let go to send."}
              </p>
              <label className="sv-check">
                <input type="checkbox" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} data-testid="talk-headphones" /> I&apos;m using headphones
              </label>
              <p className="sv-hint">
                {headphones
                  ? "The lecturer hears your microphone even while it speaks, so it stops the moment you start."
                  : "On speakers the lecturer hears silence while it speaks, so it never answers its own voice; speak clearly over it to cut in."}
              </p>
            </Box>
          )}

          {!LITE && (
            <Box label="Speech to text">
              <div className="sv-stt" role="radiogroup" aria-label="Speech to text">
                {STT_OPTIONS.map((o) => {
                  const on = o.id === "groq-turbo" ? isGroq(stt) : stt === o.id;
                  const ok = o.id === "parakeet" ? (onDevice ?? !!view.parakeet) : hasKey(o.env);
                  const why = o.id === "parakeet" ? (ok ? "On this computer: no key needed" : "The speech model isn't on this computer yet") : ok ? (o.env ? "Key set" : "No key needed") : "No key yet";
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`sv-chip${on ? " on" : ""}`}
                      onClick={() => setStt(o.id === "groq-turbo" && isGroq(stt) ? stt : o.id)}
                      title={why}
                      data-testid={`stt-${o.id}`}
                    >
                      <span className={`mark ${ok ? "ok" : "bad"}`} aria-hidden>
                        {ok ? "✓" : "✕"}
                      </span>
                      {o.label}
                      <small>{o.price}</small>
                      <span className="sv-why">{o.privacy}</span>
                    </button>
                  );
                })}
              </div>
              {isGroq(stt) && (
                <div className="sv-seg" role="radiogroup" aria-label="Groq Whisper model">
                  {(["groq-turbo", "groq-large"] as const).map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={stt === id} className={stt === id ? "on" : undefined} onClick={() => setStt(id)} title={STTS[id].hint}>
                      {id === "groq-turbo" ? "Turbo (fast)" : "large-v3 (accurate)"} · {sttPrice(STTS[id])}
                    </button>
                  ))}
                </div>
              )}
              {stt === "parakeet" && <ParakeetPanel onStatus={onParakeet} />}
              <p className="sv-hint">
                {STTS[stt].hint}{" "}
                {stt === "browser"
                  ? "Where the browser can't hear, the first with a key does (Groq, then Deepgram, then ElevenLabs)."
                  : stt === "parakeet"
                    ? "Where it can't hear (a browser set to another language, or before the model is here), what you had chosen before does, and Talk says so."
                    : "When its key is missing, the browser hears instead."}{" "}
                {MCP_PAGE ? "Used by Talk, when you ask out loud, and by the Learn professor's microphone." : "Used by the Learn professor's microphone, and by Talk on WalkMyCode's MCP page; in the app's own Talk the lecturer hears you itself."}
              </p>
            </Box>
          )}

          {!LITE && (
            <Box label="Answers when you talk">
              {view.readiness.lecturer && lecturer === view.lecturer && (
                <p className="sv-warn" role="status">
                  <b>{view.readiness.lecturer.title}.</b> {view.readiness.lecturer.message}
                </p>
              )}
              <div className="sv-chips" role="radiogroup" aria-label="Lecturer">
                {LECTURER_IDS.map((id) => {
                  const d = LECTURERS[id];
                  const ok = hasKey(d.env);
                  return (
                    <button key={id} type="button" role="radio" aria-checked={lecturer === id} className={`sv-chip${lecturer === id ? " on" : ""}`} onClick={() => pickLecturer(id)} title={d.blurb}>
                      <span className={`mark ${ok ? "ok" : "bad"}`} aria-hidden>
                        {ok ? "✓" : "✕"}
                      </span>
                      {d.label}
                      <small>{lecturerPrice(LECTURERS[id].models.find((m) => m.id === d.defaultModel)!)}</small>
                    </button>
                  );
                })}
              </div>
              {models.length > 1 && (
                <div className="sv-seg" role="radiogroup" aria-label="Lecturer model">
                  {models.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={model === m.id} className={model === m.id ? "on" : undefined} onClick={() => setModel(m.id)} title={m.detail}>
                      {m.label} · {lecturerPrice(m)}
                    </button>
                  ))}
                </div>
              )}
              <p className="sv-hint">
                {lec.blurb}. {models.find((m) => m.id === model)?.detail ?? ""}. {lec.hint}
              </p>
            </Box>
          )}
        </div>

        <div>
          {!LITE && (
            <Box label="Voice keys">
              <div className="sv-keys">
                <KeyLine
                  envVar="ELEVENLABS_API_KEY"
                  standing={keyOf("ELEVENLABS_API_KEY")}
                  label="ElevenLabs"
                  url={NARRATORS.elevenlabs.url ?? undefined}
                  hint="Saved to .walkmycode/keys.env on this computer, readable by the WalkMyCode server only. Never sent anywhere but ElevenLabs."
                  onChanged={keyChanged}
                />
                <KeyLine envVar="DEEPGRAM_API_KEY" standing={keyOf("DEEPGRAM_API_KEY")} label="Deepgram" url={NARRATORS.deepgram.url ?? undefined} hint="Saved to .walkmycode/keys.env on this computer, readable by the WalkMyCode server only. Never sent anywhere but Deepgram." onChanged={keyChanged} />
                {(!hasKey("GROQ_API_KEY") || isGroq(stt)) && (
                  <KeyLine
                    envVar="GROQ_API_KEY"
                    standing={keyOf("GROQ_API_KEY")}
                    label="Groq"
                    url={STTS["groq-turbo"].url ?? undefined}
                    hint={`${MCP_PAGE ? "" : "The same key Groq answers with under AI model. "}Saved to .walkmycode/keys.env on this computer, readable by the WalkMyCode server only. Never sent anywhere but Groq.`}
                    onChanged={keyChanged}
                  />
                )}
              </div>
            </Box>
          )}
          <Box label="Where audio and text go">
            <p className="sv-text">{voicePrivacy(narrator, LITE ? null : lecturer, LITE ? undefined : stt)}</p>
          </Box>
          <Box label="Save" className="sv-save">
            <div className="sv-row">
              <button type="button" className="hbtn small primary" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save voice"}
              </button>
              <Status s={status} />
            </div>
            <p className="sv-hint">{LITE ? "Kept in this browser." : "Saved in .walkmycode/config.json, next to the model choice."}</p>
          </Box>
        </div>
      </Cols>
    </div>
  );
}
