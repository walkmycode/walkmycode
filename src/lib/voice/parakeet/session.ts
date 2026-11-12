// One listening session of on-device speech to text (docs/VOICE.md §4d): the
// page streams the microphone in, and words come back as events. The
// detector (detect.ts) finds each utterance, the scheduler (previews.ts)
// decides when a live preview is worth decoding, and `decode` is the engine
// (engine.ts; a fake in tests). No audio is kept after its utterance is decoded.
import { UtteranceDetector, type DetectOptions } from "./detect";
import { PreviewScheduler, type PreviewOptions } from "./previews";

export type SttEvent =
  /** Speech began. */
  | { type: "speech" }
  /** The words of the utterance so far (a preview: it may still change). */
  | { type: "partial"; text: string }
  /** An utterance ended and is being written down; its "final" follows. */
  | { type: "decoding" }
  /** One finished utterance. Empty when nothing intelligible was said. */
  | { type: "final"; text: string; ms: number; audioS: number }
  /** What started was too short to be anything. */
  | { type: "discard" }
  /** Something the user should know (previews turned off, and why). */
  | { type: "notice"; message: string }
  | { type: "error"; message: string };

export interface SessionDeps {
  decode(samples: Float32Array): Promise<string>;
  now?: () => number;
  detect?: Partial<DetectOptions>;
  previews?: Partial<PreviewOptions>;
}

export class SttSession {
  readonly detector: UtteranceDetector;
  readonly previews: PreviewScheduler;
  private events: SttEvent[] = [];
  private now: () => number;
  /** Finals decode one after another, in the order they were said. */
  private finals: Promise<void> = Promise.resolve();
  /** Counts utterances, so a preview that lands late is not shown over the next one. */
  private utterance = 0;

  constructor(private deps: SessionDeps) {
    this.detector = new UtteranceDetector(deps.detect);
    this.previews = new PreviewScheduler(deps.previews);
    this.now = deps.now ?? Date.now;
  }

  /** 16 kHz mono float32 from the microphone. */
  push(samples: Float32Array): void {
    for (const e of this.detector.push(samples)) this.heard(e);
    this.maybePreview();
  }

  private heard(e: ReturnType<UtteranceDetector["push"]>[number]): void {
    if (e.type === "start") {
      this.events.push({ type: "speech" });
      return;
    }
    this.utterance++;
    this.previews.utteranceEnded();
    if (e.type === "discard") {
      this.events.push({ type: "discard" });
      return;
    }
    this.events.push({ type: "decoding" });
    const audio = e.audio;
    this.finals = this.finals.then(async () => {
      const t = this.now();
      try {
        const text = (await this.deps.decode(audio)).trim();
        this.events.push({ type: "final", text, ms: Math.round(this.now() - t), audioS: Math.round((audio.length / 16000) * 100) / 100 });
      } catch (err) {
        this.events.push({ type: "error", message: (err as Error)?.message || "That couldn't be written down. Say it again?" });
      }
    });
  }

  private maybePreview(): void {
    const d = this.detector;
    if (!this.previews.due(this.now(), { speaking: d.speaking, voicedS: d.voicedS })) return;
    const audio = d.tail(this.previews.o.windowS);
    if (!audio.length) return;
    const of = this.utterance;
    this.previews.begin(this.now());
    void this.deps
      .decode(audio)
      .then((text) => {
        // The utterance may have ended meanwhile: its final text says it better.
        if (of === this.utterance && this.detector.speaking && text.trim()) this.events.push({ type: "partial", text: text.trim() });
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
    this.utterance++;
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
