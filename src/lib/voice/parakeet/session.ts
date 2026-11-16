// One listening session of on-device speech to text (docs/VOICE.md §4d): the
// page streams the microphone in, and words come back as events. The
// detector (detect.ts) finds each utterance; pieces.ts cuts it at the
// speaker's pauses, and each piece is written down while they go on talking;
// the scheduler (previews.ts) decides when a live preview of what follows the
// last cut is worth decoding; `decode` is the engine (engine.ts; a fake in
// tests). The final text is the pieces' words, so when an utterance ends there
// is little or nothing left to decode. No audio is kept after its utterance is
// decoded.
import { FRAME, FRAME_S, RATE, UtteranceDetector, type DetectEvent, type DetectOptions } from "./detect";
import { cutAt, PIECE_DEFAULTS, stitch, type PieceOptions } from "./pieces";
import { PreviewScheduler, type PreviewOptions } from "./previews";

export type SttEvent =
  /** Speech began. */
  | { type: "speech" }
  /** The words of the utterance so far (a preview: it may still change). */
  | { type: "partial"; text: string }
  /** An utterance ended and is being written down; its "final" follows. */
  | { type: "decoding" }
  /** One finished utterance, `ms` after it ended. Empty when nothing intelligible was said. */
  | { type: "final"; text: string; ms: number; audioS: number }
  /** What started was too short to be anything. */
  | { type: "discard" }
  /** Something the user should know (previews turned off, and why). */
  | { type: "notice"; message: string }
  | { type: "error"; message: string };

/** A piece of the final text goes before any preview (engine.ts). */
export type DecodeKind = "final" | "preview";

export interface SessionDeps {
  decode(samples: Float32Array, kind?: DecodeKind): Promise<string>;
  now?: () => number;
  detect?: Partial<DetectOptions>;
  previews?: Partial<PreviewOptions>;
  pieces?: Partial<PieceOptions>;
}

/** A piece of an utterance, being written down or written. */
interface Piece {
  /** Its first frame. */
  from: number;
  text: string | null;
  /** What a preview of it said, shown until its own text is in. */
  stand: string;
  done: Promise<string>;
}

/** The utterance being heard. */
interface Utterance {
  pieces: Piece[];
  /** Where the piece being said began (a frame). */
  cut: number;
  /** The last preview of the piece being said. */
  tail: { from: number; text: string } | null;
  /** The frame the last preview reached. */
  previewedTo: number;
  /** Pieces still being written down. */
  writing: number;
  /** The partial text last sent. */
  shown: string;
}

export class SttSession {
  readonly detector: UtteranceDetector;
  readonly previews: PreviewScheduler;
  readonly pieces: PieceOptions;
  private events: SttEvent[] = [];
  private now: () => number;
  /** Finals are sent one after another, in the order they were said. */
  private finals: Promise<void> = Promise.resolve();
  private u: Utterance | null = null;

  constructor(private deps: SessionDeps) {
    this.detector = new UtteranceDetector(deps.detect);
    this.previews = new PreviewScheduler(deps.previews);
    this.pieces = { ...PIECE_DEFAULTS, ...deps.pieces };
    this.now = deps.now ?? Date.now;
  }

  /** 16 kHz mono float32 from the microphone. */
  push(samples: Float32Array): void {
    for (const e of this.detector.push(samples)) this.heard(e);
    const u = this.u;
    if (!u || !this.detector.speaking) return;
    const at = cutAt(this.detector, u.cut, this.pieces);
    if (at !== null) this.write(u, u.cut, this.detector.slice(u.cut, at), at);
    this.maybePreview(u);
  }

  private heard(e: DetectEvent): void {
    if (e.type === "start") {
      this.u = { pieces: [], cut: 0, tail: null, previewedTo: 0, writing: 0, shown: "" };
      this.events.push({ type: "speech" });
      return;
    }
    const u = this.u ?? { pieces: [], cut: 0, tail: null, previewedTo: 0, writing: 0, shown: "" };
    this.u = null;
    this.previews.utteranceEnded();
    if (e.type === "discard") {
      this.events.push({ type: "discard" });
      return;
    }
    const ended = this.now();
    // What was said after the last cut; nothing when the last piece was cut at the start of this silence.
    if (e.lastVoiced >= u.cut || !u.pieces.length) this.write(u, u.cut, e.audio.subarray(Math.min(e.audio.length, u.cut * FRAME)), null);
    this.events.push({ type: "decoding" });
    const pieces = u.pieces.map((p) => p.done);
    const audioS = Math.round((e.audio.length / RATE) * 100) / 100;
    this.finals = this.finals.then(async () => {
      try {
        const text = stitch(await Promise.all(pieces));
        this.events.push({ type: "final", text, ms: Math.round(this.now() - ended), audioS });
      } catch (err) {
        this.events.push({ type: "error", message: (err as Error)?.message || "That couldn't be written down. Say it again?" });
      }
    });
  }

  /** Write down the piece from frame `from` (its audio given); the next piece starts at `next`. */
  private write(u: Utterance, from: number, audio: Float32Array, next: number | null): void {
    const piece: Piece = { from, text: null, stand: u.tail?.from === from ? u.tail.text : "", done: Promise.resolve("") };
    u.pieces.push(piece);
    if (next !== null) {
      u.cut = next;
      u.tail = null;
    }
    u.writing++;
    this.previews.share();
    piece.done = this.deps.decode(audio, "final").then(
      (t) => {
        piece.text = t.trim();
        u.writing--;
        this.show(u);
        return piece.text;
      },
      (err: unknown) => {
        u.writing--;
        throw err;
      },
    );
    piece.done.catch(() => {}); // the final reports it
  }

  /** The words so far, when they changed and the utterance is still being said. */
  private show(u: Utterance): void {
    if (u !== this.u || !this.detector.speaking) return;
    const text = stitch([...u.pieces.map((p) => p.text ?? p.stand), u.tail?.from === u.cut ? u.tail.text : ""]);
    if (!text || text === u.shown) return;
    u.shown = text;
    this.events.push({ type: "partial", text });
  }

  private maybePreview(u: Utterance): void {
    const d = this.detector;
    // Voice since the last cut: just after one there may be only a breath or half a word, and the model makes a word of it.
    const heard = { speaking: d.speaking, voicedS: d.voicedFrom(u.cut) * FRAME_S, fresh: d.lastVoiced >= u.previewedTo, busy: u.writing > 0 };
    if (!this.previews.due(this.now(), heard)) return;
    const from = u.cut;
    const to = d.frameCount;
    u.previewedTo = to;
    this.previews.begin(this.now());
    void this.deps
      .decode(d.slice(from, to), "preview")
      .then((t) => {
        const text = t.trim();
        // The utterance may have ended meanwhile: its final text says it better.
        if (u !== this.u || !text) return;
        if (from === u.cut) u.tail = { from, text };
        else {
          // A piece was cut since: this stands in for it until its own text is in.
          const piece = u.pieces.find((p) => p.from === from);
          if (!piece || piece.text !== null) return;
          piece.stand = text;
        }
        this.show(u);
      })
      .catch(() => {})
      .finally(() => {
        const why = this.previews.finish(this.now());
        if (why) this.events.push({ type: "notice", message: why });
      });
  }

  /** Stop was pressed (or push-to-talk let go): decode what is left; resolves when every final is in. */
  async flush(): Promise<void> {
    const e = this.detector.flush();
    if (e) this.heard(e);
    await this.finals;
  }

  /** Forget what is being heard (muted, or our own voice was playing). */
  reset(): void {
    this.detector.reset();
    this.u = null;
    this.previews.utteranceEnded();
  }

  /** The events since the last take(), in order. */
  take(): SttEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Resolves when every utterance heard so far has its final text. */
  settled(): Promise<void> {
    return this.finals;
  }
}
