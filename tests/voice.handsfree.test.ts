// Hands-free Talk (docs/VOICE.md §4c) without a microphone: the VAD on
// synthetic audio frames (where each utterance starts and ends, the noise
// floor, the echo of our own voice and a barge-in over it), the transcript and
// WAV pieces, the hearing engine with a fake microphone and recognizer, the
// conversation's state machine (barge-in, "Still there?" and the automatic
// end, hold to talk), and the lecturers' echo guard.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentSettings, FLUX_TURN } from "../src/lib/voice/agentSettings";
import { AUTO_END_MS, GATHER_MS, hears, initialTalk, pillLabel, reduceTalk, STILL_THERE_MS, type TalkAction, type TalkEffect, type TalkState } from "../src/lib/voice/handsfree/conversation";
import { Ear, type MicHandle } from "../src/lib/voice/handsfree/ear";
import { pcmToWav, Transcript } from "../src/lib/voice/handsfree/utterance";
import { rms, Vad, type VadEvent } from "../src/lib/voice/handsfree/vad";
import { initialState, micRoute, reduce, type Action, type AgentState } from "../src/lib/voice/lecturer/deepgram/reducer";
import { ElevenAgentsLecturer, type ElevenConversationLike } from "../src/lib/voice/lecturer/elevenagents";
import type { LecturerEvent } from "../src/lib/voice/lecturer/session";
import type { RecognitionCtor } from "../src/lib/voice/listen";

// ── synthetic audio: 20 ms frames at 16 kHz ──

let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

/** A voiced frame: a 180 Hz tone at `amp` (0–1) with a little noise. */
function voice(amp: number, at = 0): Int16Array {
  const f = new Int16Array(320);
  for (let i = 0; i < f.length; i++) f[i] = Math.round((Math.sin((2 * Math.PI * 180 * (at * 320 + i)) / 16000) * amp + random() * amp * 0.1) * 32767);
  return f;
}
/** Room noise at `amp`. */
function noise(amp: number): Int16Array {
  const f = new Int16Array(320);
  for (let i = 0; i < f.length; i++) f[i] = Math.round(random() * amp * 32767);
  return f;
}

/** Feed frames to a VAD; the events, each with the index of the frame that caused it. */
function feed(v: Vad, frames: Int16Array[], from = 0): { at: number; e: VadEvent }[] {
  const out: { at: number; e: VadEvent }[] = [];
  frames.forEach((f, i) => {
    const e = v.push(rms(f, true));
    if (e) out.push({ at: from + i, e });
  });
  return out;
}

const repeat = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe("VAD: synthetic frames → utterance boundaries", () => {
  it("finds one utterance: speech starts after a short loud run and ends after ~0.8 s of quiet", () => {
    const v = new Vad();
    const frames = [...repeat(50, () => noise(0.003)), ...repeat(60, (i) => voice(0.25, i)), ...repeat(60, () => noise(0.003))];
    const events = feed(v, frames);
    assert.equal(events.length, 2, JSON.stringify(events));
    assert.deepEqual(events[0].e, { type: "start", barge: false });
    assert.ok(events[0].at >= 50 && events[0].at <= 54, `starts within 80 ms of the voice: frame ${events[0].at}`);
    assert.equal(events[1].e.type, "end");
    const quiet = (events[1].at - 109) * 20;
    assert.ok(quiet >= 700 && quiet <= 900, `ends after 700–900 ms of quiet: ${quiet} ms`);
    if (events[1].e.type === "end") assert.ok(Math.abs(events[1].e.speechMs - 1200) <= 100, `about 1.2 s of speech: ${events[1].e.speechMs}`);
  });

  it("two utterances with a pause between are two; a short dip inside one is not an end", () => {
    const v = new Vad();
    const dip = repeat(15, () => noise(0.003)); // 300 ms: a breath
    const frames = [...repeat(30, () => noise(0.003)), ...repeat(40, (i) => voice(0.2, i)), ...dip, ...repeat(40, (i) => voice(0.2, i)), ...repeat(60, () => noise(0.003)), ...repeat(30, (i) => voice(0.2, i)), ...repeat(60, () => noise(0.003))];
    const kinds = feed(v, frames).map((x) => x.e.type);
    assert.deepEqual(kinds, ["start", "end", "start", "end"]);
  });

  it("a click or a cough is not a question", () => {
    const v = new Vad();
    const events = feed(v, [...repeat(30, () => noise(0.003)), ...repeat(6, (i) => voice(0.3, i)), ...repeat(60, () => noise(0.003))]);
    assert.deepEqual(
      events.map((x) => x.e.type),
      ["start", "discard"],
    );
    const v2 = new Vad();
    assert.deepEqual(feed(v2, [...repeat(30, () => noise(0.003)), ...repeat(2, (i) => voice(0.4, i)), ...repeat(30, () => noise(0.003))]), [], "two loud frames never start");
  });

  it("adapts to the noise floor: a steady fan raises the bar instead of holding an utterance open", () => {
    const v = new Vad();
    // A fan louder than the fixed minimum, there as the microphone opens, for 2 s: no speech.
    assert.deepEqual(feed(v, repeat(100, () => noise(0.03))), [], "a steady fan is not speech");
    assert.ok(v.floor > 0.01, `the floor rose to the fan: ${v.floor}`);
    // Speech well above the fan is still heard, and ends when only the fan is left.
    const events = feed(v, [...repeat(40, (i) => voice(0.3, i)), ...repeat(60, () => noise(0.03))]);
    assert.deepEqual(
      events.map((x) => x.e.type),
      ["start", "end"],
    );
  });

  it("while our own voice plays, its echo is ignored and only clearly louder speech counts (a barge-in)", () => {
    const v = new Vad();
    feed(v, repeat(30, () => noise(0.003)));
    v.setPlayback(true);
    // The speakers' echo, as loud as quiet speech, for 2 s: nothing.
    assert.deepEqual(feed(v, repeat(100, (i) => voice(0.04, i))), [], "the echo never starts an utterance");
    const echo = rms(voice(0.04), true);
    assert.ok(v.threshold() >= echo * 2, `the bar sits well above the echo (${echo.toFixed(3)}): ${v.threshold()}`);
    // The user cuts in, well above the echo.
    const events = feed(v, repeat(20, (i) => voice(0.5, i)));
    assert.deepEqual(events[0]?.e, { type: "start", barge: true });
    assert.ok(events[0].at >= 7, "a barge-in needs ~160 ms, not one loud frame");
  });
});

describe("transcript and WAV", () => {
  it("takes each utterance once, and drops the echo heard while our voice played", () => {
    const t = new Transcript();
    t.update([{ text: "how does", final: false }]);
    assert.equal(t.text(), "how does");
    t.update([{ text: "how does login work", final: true }]);
    assert.equal(t.settled(), true);
    assert.equal(t.take(), "how does login work");
    assert.equal(t.text(), "");
    // The echo of our voice comes in as finished phrases, while the user's words are still interim.
    t.update([{ text: "how does login work", final: true }, { text: "the session is kept", final: true }, { text: "wait", final: false }]);
    t.drop(true);
    assert.equal(t.text(), "wait");
    t.drop();
    assert.equal(t.text(), "");
    t.restart();
    t.update([{ text: "again", final: true }]);
    assert.equal(t.take(), "again");
  });

  it("writes 16 kHz mono 16-bit WAV", () => {
    const wav = pcmToWav([new Int16Array([1, -1]), new Int16Array([32767])]);
    const v = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
    assert.equal(v.getUint32(24, true), 16000);
    assert.equal(v.getUint16(22, true), 1);
    assert.equal(v.getUint32(40, true), 6);
    assert.equal(v.getInt16(44, true), 1);
    assert.equal(v.getInt16(46, true), -1);
    assert.equal(v.getInt16(48, true), 32767);
  });
});

// ── the hearing engine, with a fake microphone, recognizer and clock ──

function harness(via: "browser" | "deepgram") {
  let onFrame: ((f: Int16Array) => void) | null = null;
  let micClosed = false;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let clock = 0;
  let id = 0;
  const heard: string[] = [];
  const starts: boolean[] = [];
  const interims: string[] = [];
  const wavs: Uint8Array[] = [];
  let rec: { onresult: ((e: unknown) => void) | null; started: number; aborted: boolean } | null = null;
  const Recognition = class {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror = null;
    onend = null;
    started = 0;
    aborted = false;
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      rec = this;
    }
    start() {
      this.started++;
    }
    stop() {}
    abort() {
      this.aborted = true;
    }
  } as unknown as RecognitionCtor;
  const ear = new Ear(
    {
      via,
      mic: async (cb) => {
        onFrame = cb;
        return { close: () => (micClosed = true) } satisfies MicHandle;
      },
      Recognition,
      transcribe: async (wav) => {
        wavs.push(wav);
        return "where is the cart";
      },
      setTimeout: (fn, ms) => {
        timers.push({ at: clock + ms, fn, id: ++id });
        return id;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    { utterance: (t) => heard.push(t), speechStart: (b) => starts.push(b), interim: (t) => interims.push(t) },
  );
  const frames = (list: Int16Array[]) => {
    for (const f of list) {
      clock += 20;
      onFrame?.(f);
      for (const t of timers.filter((x) => x.at <= clock)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    }
  };
  const results = (list: { text: string; final: boolean }[]) =>
    rec?.onresult?.({ resultIndex: 0, results: list.map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.final })) });
  return { ear, frames, results, heard, starts, interims, wavs, micClosed: () => micClosed, rec: () => rec };
}

describe("the hearing engine (Talk through Claude, Free voice)", () => {
  it("browser recognition: each pause after speech sends what was heard as one utterance, with no key held", async () => {
    const h = harness("browser");
    await h.ear.start();
    h.frames(repeat(30, () => noise(0.003)));
    h.frames(repeat(20, (i) => voice(0.25, i)));
    h.results([{ text: "how does", final: false }]);
    h.frames(repeat(20, (i) => voice(0.25, i)));
    h.results([{ text: "how does login work", final: true }]);
    assert.deepEqual(h.heard, [], "nothing is sent while still speaking");
    h.frames(repeat(70, () => noise(0.003)));
    assert.deepEqual(h.heard, ["how does login work"]);
    assert.equal(h.interims.at(-1), "", "the interim words are cleared once sent");
    assert.ok(h.interims.includes("how does"), "words show as they are heard");
    // A second question in the same conversation is a second utterance.
    h.frames(repeat(30, (i) => voice(0.25, i)));
    h.results([{ text: "how does login work", final: true }, { text: "and sign out", final: true }]);
    h.frames(repeat(70, () => noise(0.003)));
    assert.deepEqual(h.heard, ["how does login work", "and sign out"]);
    h.ear.close();
    assert.equal(h.micClosed(), true, "the microphone is released");
    assert.equal(h.rec()?.aborted, true);
  });

  it("drops the echo of our own voice, but a barge-in is heard", async () => {
    const h = harness("browser");
    await h.ear.start();
    h.frames(repeat(30, () => noise(0.003)));
    h.ear.setPlayback(true);
    // The recognizer hears our narration through the speakers.
    h.frames(repeat(30, (i) => voice(0.04, i)));
    h.results([{ text: "login starts in the route", final: true }]);
    h.frames(repeat(80, (i) => voice(0.04, i)));
    h.ear.setPlayback(false);
    h.frames(repeat(70, () => noise(0.003)));
    assert.deepEqual(h.heard, [], "our own words are never sent back");
    assert.deepEqual(h.starts, []);
    // Speaking again: the user cuts in over the narration.
    h.ear.setPlayback(true);
    h.frames(repeat(20, (i) => voice(0.04, i)));
    h.frames(repeat(15, (i) => voice(0.5, i)));
    assert.deepEqual(h.starts, [true], "a barge-in is reported");
    h.ear.setPlayback(false); // the page stopped the narration
    h.results([{ text: "login starts in the route", final: true }, { text: "stop, what about tokens", final: true }]);
    h.frames(repeat(70, () => noise(0.003)));
    assert.deepEqual(h.heard, ["stop, what about tokens"]);
  });

  it("muted or not held, nothing counts", async () => {
    const h = harness("browser");
    await h.ear.start();
    h.ear.setOpen(false);
    h.frames(repeat(30, (i) => voice(0.25, i)));
    h.results([{ text: "private aside", final: true }]);
    h.frames(repeat(70, () => noise(0.003)));
    assert.deepEqual(h.heard, []);
    assert.deepEqual(h.starts, []);
  });

  it("with a key instead of recognition: the utterance's audio goes once, as WAV, from just before it began", async () => {
    const h = harness("deepgram");
    await h.ear.start();
    h.frames(repeat(30, () => noise(0.003)));
    h.frames(repeat(50, (i) => voice(0.25, i)));
    h.frames(repeat(60, () => noise(0.003)));
    await new Promise((r) => setImmediate(r));
    assert.equal(h.wavs.length, 1);
    const samples = (h.wavs[0].length - 44) / 2;
    assert.ok(samples >= (50 + 40) * 320, `the voice and the quiet after it, and some before: ${samples} samples`);
    assert.deepEqual(h.heard, ["where is the cart"]);
  });
});

// ── the conversation ──

function run(actions: TalkAction[], from: TalkState = initialTalk()) {
  let s = from;
  const fx: TalkEffect[] = [];
  for (const a of actions) {
    const r = reduceTalk(s, a);
    s = r.state;
    fx.push(...r.effects);
  }
  return { s, fx };
}

describe("the conversation: barge-in", () => {
  it("one tap starts it hands-free; what is said goes after a quiet moment; speaking over the answer stops it and listens", () => {
    let r = run([{ type: "start", at: 0, input: "hands-free" }]);
    assert.equal(r.s.phase, "listening");
    assert.equal(pillLabel(r.s), "Listening");
    assert.equal(hears(r.s), true, "no key held");
    r = run([{ type: "user-start", at: 100 }, { type: "user-end", at: 900, text: "how does login work" }], r.s);
    assert.deepEqual(r.fx, [], "a pause might be mid-thought: nothing goes yet");
    assert.equal(r.s.gathered, "how does login work");
    r = run([{ type: "settle", at: 900 + GATHER_MS }], r.s);
    assert.deepEqual(r.fx, [{ do: "send", text: "how does login work" }]);
    assert.equal(pillLabel(r.s), "Thinking");
    r = run([{ type: "speaking", on: true, at: 2000 }], r.s);
    assert.equal(pillLabel(r.s), "Speaking");
    r = run([{ type: "user-start", at: 2500 }], r.s);
    assert.deepEqual(r.fx, [{ do: "barge-in" }], "the voice stops at once");
    assert.equal(r.s.phase, "hearing");
    assert.equal(pillLabel(r.s), "Hearing");
    // The interrupted reply's end does not take the floor back.
    r = run([{ type: "speaking", on: false, at: 2510 }], r.s);
    assert.equal(r.s.phase, "hearing");
    r = run([{ type: "user-end", at: 3000, text: "what about tokens" }, { type: "done", at: 5000 }], r.s);
    assert.equal(r.s.phase, "listening");
  });

  it("muted is Paused: speech is ignored, and nothing barges in", () => {
    let r = run([{ type: "start", at: 0, input: "hands-free" }, { type: "speaking", on: true, at: 10 }, { type: "mute", muted: true, at: 20 }]);
    assert.equal(pillLabel(r.s), "Paused");
    r = run([{ type: "user-start", at: 30 }, { type: "user-end", at: 900, text: "aside" }], r.s);
    assert.deepEqual(r.fx, []);
    r = run([{ type: "mute", muted: false, at: 1000 }, { type: "user-start", at: 1100 }], r.s);
    assert.deepEqual(r.fx, [{ do: "barge-in" }]);
  });

  it("is off before it starts and after it ends", () => {
    let r = run([{ type: "user-start", at: 0 }]);
    assert.equal(r.s.phase, "off");
    assert.equal(pillLabel(r.s), null);
    r = run([{ type: "start", at: 0, input: "hands-free", connecting: true }, { type: "user-start", at: 10 }], r.s);
    assert.equal(pillLabel(r.s), "Connecting");
    assert.equal(r.s.phase, "connecting", "nothing is heard before the lecturer is live");
    r = run([{ type: "live", at: 20 }, { type: "end", at: 30, reason: "ended" }], r.s);
    assert.deepEqual(r.fx, [{ do: "end", reason: "ended" }]);
    assert.equal(r.s.phase, "off");
  });
});

describe("the conversation: one question, however you pause", () => {
  const talking = () => run([{ type: "start", at: 0, input: "hands-free" }]).s;

  it("pauses mid-thought join what was said into one question, in order", () => {
    let r = run([{ type: "user-start", at: 100 }, { type: "user-end", at: 900, text: "think" }], talking());
    r = run([{ type: "settle", at: 900 + GATHER_MS - 100 }], r.s);
    assert.deepEqual(r.fx, [], "not quiet long enough yet");
    r = run([{ type: "user-start", at: 1500 }, { type: "settle", at: 900 + GATHER_MS }], r.s);
    assert.deepEqual(r.fx, [], "still speaking: nothing goes");
    r = run([{ type: "user-end", at: 3000, text: "about how sign-in works" }, { type: "settle", at: 3000 + GATHER_MS }], r.s);
    assert.deepEqual(r.fx, [{ do: "send", text: "think about how sign-in works" }]);
    assert.equal(r.s.gathered, "");
    assert.equal(r.s.asked, "think about how sign-in works");
  });

  it("more said before the answer comes resends the whole question, which replaces the unanswered one", () => {
    let r = run([{ type: "user-start", at: 100 }, { type: "user-end", at: 900, text: "think" }, { type: "settle", at: 900 + GATHER_MS }], talking());
    assert.deepEqual(r.fx, [{ do: "send", text: "think" }]);
    r = run([{ type: "user-start", at: 4000 }, { type: "user-end", at: 5000, text: "all right, you continue" }, { type: "settle", at: 5000 + GATHER_MS }], r.s);
    assert.deepEqual(r.fx, [{ do: "send", text: "think all right, you continue", continues: true }]);
    // Once it is answered, the next thing said is a new question (the conversation keeps the context).
    r = run([{ type: "done", at: 9000 }, { type: "user-start", at: 9500 }, { type: "user-end", at: 10_000, text: "and sign-out?" }, { type: "settle", at: 10_000 + GATHER_MS }], r.s);
    assert.deepEqual(r.fx, [{ do: "send", text: "and sign-out?" }]);
  });

  it("a missed settle is caught by the clock; tapping to end still sends what was just said", () => {
    let r = run([{ type: "user-start", at: 100 }, { type: "user-end", at: 900, text: "where is the cart" }, { type: "tick", at: 3000 }], talking());
    assert.deepEqual(r.fx, [{ do: "send", text: "where is the cart" }]);
    r = run([{ type: "user-start", at: 100 }, { type: "user-end", at: 900, text: "one more thing" }, { type: "end", at: 1000, reason: "ended" }], talking());
    assert.deepEqual(r.fx, [{ do: "send", text: "one more thing" }, { do: "end", reason: "ended" }]);
    assert.equal(r.s.gathered, "");
  });

  it("hold to talk sends each hold as it is let go; a hold before the answer continues the question", () => {
    let r = run([{ type: "start", at: 0, input: "push-to-talk" }, { type: "press", at: 10 }, { type: "release", at: 500 }, { type: "user-end", at: 700, text: "the cart" }]);
    assert.deepEqual(r.fx, [{ do: "commit" }, { do: "send", text: "the cart" }]);
    r = run([{ type: "press", at: 1000 }, { type: "release", at: 1500 }, { type: "user-end", at: 1700, text: "and checkout" }], r.s);
    assert.deepEqual(r.fx, [{ do: "commit" }, { do: "send", text: "the cart and checkout", continues: true }]);
  });
});

describe("the conversation: auto-end", () => {
  it("says \"Still there?\" after 45 s of quiet and ends after 60 s, letting the microphone go", () => {
    let r = run([{ type: "start", at: 0, input: "hands-free" }]);
    r = run([{ type: "tick", at: STILL_THERE_MS - 1000 }], r.s);
    assert.deepEqual(r.fx, []);
    r = run([{ type: "tick", at: STILL_THERE_MS }], r.s);
    assert.deepEqual(r.fx, [{ do: "still-there" }]);
    assert.equal(pillLabel(r.s), "Still there?");
    r = run([{ type: "tick", at: STILL_THERE_MS + 1000 }], r.s);
    assert.deepEqual(r.fx, [], "said once");
    r = run([{ type: "tick", at: AUTO_END_MS }], r.s);
    assert.deepEqual(r.fx, [{ do: "end", reason: "idle" }]);
    assert.equal(r.s.phase, "off");
  });

  it("anything said resets the clock; while it thinks or speaks the clock waits", () => {
    let r = run([{ type: "start", at: 0, input: "hands-free" }, { type: "tick", at: STILL_THERE_MS }]);
    r = run([{ type: "user-start", at: 50_000 }, { type: "user-end", at: 51_000, text: "yes" }], r.s);
    assert.equal(pillLabel(r.s), "Listening", "the prompt goes when you speak");
    r = run([{ type: "settle", at: 51_000 + GATHER_MS }], r.s);
    assert.equal(pillLabel(r.s), "Thinking");
    r = run([{ type: "tick", at: 200_000 }], r.s);
    assert.deepEqual(r.fx, [], "a slow answer is not silence");
    r = run([{ type: "speaking", on: true, at: 200_500 }, { type: "tick", at: 400_000 }, { type: "speaking", on: false, at: 400_500 }], r.s);
    assert.deepEqual(r.fx, []);
    r = run([{ type: "tick", at: 400_500 + AUTO_END_MS - 1 }], r.s);
    assert.ok(!r.fx.some((e) => e.do === "end"));
    r = run([{ type: "tick", at: 400_500 + AUTO_END_MS }], r.s);
    assert.ok(r.fx.some((e) => e.do === "end"));
  });
});

describe("the conversation: hold to talk (Settings → Voice)", () => {
  it("speech counts only while held; letting go ends the utterance at once", () => {
    let r = run([{ type: "start", at: 0, input: "push-to-talk" }]);
    assert.equal(pillLabel(r.s), "Hold to talk");
    assert.equal(hears(r.s), false);
    r = run([{ type: "user-start", at: 10 }], r.s);
    assert.equal(r.s.phase, "listening", "not held: ignored");
    r = run([{ type: "press", at: 20 }], r.s);
    assert.equal(hears(r.s), true);
    assert.equal(pillLabel(r.s), "Hearing");
    r = run([{ type: "release", at: 900 }], r.s);
    assert.deepEqual(r.fx, [{ do: "commit" }]);
    // The words arrive after the release, and still count.
    r = run([{ type: "user-end", at: 1200, text: "where is the cart" }], r.s);
    assert.deepEqual(r.fx, [{ do: "send", text: "where is the cart" }]);
  });

  it("holding while it speaks cuts it off; hands-free taps do nothing to press", () => {
    let r = run([{ type: "start", at: 0, input: "push-to-talk" }, { type: "speaking", on: true, at: 10 }, { type: "press", at: 20 }]);
    assert.deepEqual(r.fx, [{ do: "barge-in" }]);
    r = run([{ type: "start", at: 0, input: "hands-free" }, { type: "press", at: 20 }], initialTalk());
    assert.equal(r.s.held, false);
  });
});

// ── the lecturers ──

describe("Deepgram: Flux turn detection and the echo guard", () => {
  it("asks Flux for its end-of-turn detection, within the documented ranges", () => {
    const p = buildAgentSettings({ model: "fast" }).agent.listen.provider;
    assert.equal(p.eot_threshold, FLUX_TURN.eot_threshold);
    assert.ok(p.eot_threshold! >= 0.5 && p.eot_threshold! <= 1);
    assert.equal(p.eot_timeout_ms, FLUX_TURN.eot_timeout_ms);
    assert.ok(!("eager_eot_threshold" in p));
  });

  const live = (headphones = false): AgentState => {
    let s = initialState(0, "hands-free", headphones);
    for (const a of [
      { type: "connect", at: 0 },
      { type: "socket-open", at: 1 },
      { type: "message", msg: { type: "SettingsApplied" }, at: 2 },
    ] as Action[])
      s = reduce(s, a).state;
    return s;
  };

  it("on speakers, sends silence while the lecturer speaks; a barge cuts it off and the real microphone flows", () => {
    let s = live();
    assert.equal(s.mic, "live");
    let r = reduce(s, { type: "message", msg: { type: "AgentStartedSpeaking" }, at: 10 });
    s = r.state;
    assert.equal(s.mic, "guard", "Deepgram hears silence, never its own voice");
    assert.ok(!r.effects.some((e) => e.do === "emit" && e.event.type === "mic"), "the conversation still counts as listening");
    r = reduce(s, { type: "barge", at: 20 });
    s = r.state;
    assert.ok(r.effects.some((e) => e.do === "flush"), "the speaker stops at once");
    assert.ok(r.effects.some((e) => e.do === "emit" && e.event.type === "speaking" && !e.event.on));
    assert.ok(r.effects.some((e) => e.do === "emit" && e.event.type === "listening" && e.event.on));
    assert.equal(s.mic, "live");
    assert.equal(s.gate, true, "the rest of the reply is dropped");
    // A barge when the lecturer is not speaking does nothing.
    assert.deepEqual(reduce(s, { type: "barge", at: 30 }).effects, []);
  });

  it("with headphones, the real microphone goes even while the lecturer speaks", () => {
    let s = live(true);
    s = reduce(s, { type: "message", msg: { type: "AgentStartedSpeaking" }, at: 10 }).state;
    assert.equal(s.mic, "live");
    s = reduce(s, { type: "headphones", on: false, at: 20 }).state;
    assert.equal(micRoute(s, 20), "guard");
  });
});

describe("ElevenAgents: hands-free, the echo guard and headphones", () => {
  async function start(headphones: boolean) {
    const muted: boolean[] = [];
    let options: Record<string, (p: unknown) => void> = {};
    const conv: ElevenConversationLike = { endSession: async () => {}, setMicMuted: (m) => muted.push(m), setVolume: () => {}, sendContextualUpdate: () => {} };
    const lec = new ElevenAgentsLecturer({
      fetch: (async () => Response.json({ signed_url: "wss://x", agent_id: "a", overrides: {} })) as unknown as typeof fetch,
      start: async (o) => {
        options = o as typeof options;
        return conv;
      },
      context: () => ({ mapSummary: "", keyterms: [] }),
      input: "hands-free",
      headphones,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const seen: LecturerEvent[] = [];
    lec.on((e) => seen.push(e));
    await lec.connect();
    return { lec, muted, options: () => options, seen };
  }

  it("on speakers, the agent's microphone is muted while it speaks and opens again after", async () => {
    const t = await start(false);
    assert.equal(t.muted.at(-1), false, "hands-free: open from the start");
    t.options().onModeChange({ mode: "speaking" });
    assert.equal(t.muted.at(-1), true, "it never hears itself");
    assert.ok(t.seen.filter((e) => e.type === "mic").every((e) => e.type === "mic" && e.open), "the conversation still counts as listening");
    t.options().onModeChange({ mode: "listening" });
    assert.equal(t.muted.at(-1), false);
  });

  it("with headphones, the microphone stays open while it speaks", async () => {
    const t = await start(true);
    t.options().onModeChange({ mode: "speaking" });
    assert.equal(t.muted.at(-1), false);
    t.lec.setHeadphones(false);
    assert.equal(t.muted.at(-1), true);
  });
});
