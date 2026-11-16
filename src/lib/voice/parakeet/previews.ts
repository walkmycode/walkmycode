// When to decode a live preview while someone is still speaking (docs/VOICE.md
// §4d). Pure: the session asks due() as audio arrives and tells it when a
// preview began and ended.
//
// - A preview decodes what was said since the last piece was cut (pieces.ts),
//   so it stays a few seconds long however long the utterance gets.
// - One comes once START_VOICED_S of speech has been heard since the last cut
//   (just after one there may be only a breath or half a word); then at
//   most one every INTERVAL_MS, and after a preview that took T the computer
//   rests REST_FRACTION × T first, so a slower computer previews less often
//   instead of falling behind.
// - Never two at once, never while a piece of the final text is being written
//   (the final text goes first), and only when something new was said since
//   the last one.
// - A preview slower than SLOW_MS is slow; SLOW_LIMIT of them turn previews off
//   for the session, with the reason, so a very slow computer spends its time
//   on the final text. A preview that shared the computer with the final text
//   is not counted.

export interface PreviewOptions {
  intervalMs: number;
  /** Voiced audio heard before a preview, in seconds: in the utterance, and since the last piece was cut. */
  startVoicedS: number;
  /** After a preview that took T ms, wait T × this before the next. */
  restFraction: number;
  /** A preview that takes longer than this is slow. */
  slowMs: number;
  /** This many slow previews turn them off. */
  slowLimit: number;
}

export const PREVIEW_DEFAULTS: PreviewOptions = { intervalMs: 1000, startVoicedS: 0.8, restFraction: 0.5, slowMs: 2500, slowLimit: 2 };

export interface PreviewHeard {
  speaking: boolean;
  /** Voiced seconds since the last piece was cut (the utterance's, before the first). */
  voicedS: number;
  /** Something was said since the last preview. */
  fresh?: boolean;
  /** A piece of the final text is being written. */
  busy?: boolean;
}

export class PreviewScheduler {
  readonly o: PreviewOptions;
  /** Why previews are off for this session, or null while they are on. */
  off: string | null = null;
  private running = false;
  private shared = false;
  private startedAt = -Infinity;
  private began = 0;
  private endedAt = -Infinity;
  private rest = 0;
  private slow = 0;

  constructor(o: Partial<PreviewOptions> = {}) {
    this.o = { ...PREVIEW_DEFAULTS, ...o };
  }

  /** Whether a preview should start now. */
  due(now: number, heard: PreviewHeard): boolean {
    if (this.off || this.running || !heard.speaking || heard.busy || heard.fresh === false) return false;
    if (heard.voicedS < this.o.startVoicedS) return false;
    return now - this.startedAt >= this.o.intervalMs && now - this.endedAt >= this.rest;
  }

  begin(now: number): void {
    this.running = true;
    this.shared = false;
    this.startedAt = now;
    this.began = now;
  }

  /** The final text is being written while this preview runs: its time says nothing about the computer. */
  share(): void {
    if (this.running) this.shared = true;
  }

  /** The preview that began is over. Returns the reason when this one turned previews off. */
  finish(now: number): string | null {
    if (!this.running) return null;
    this.running = false;
    const took = now - this.began;
    this.endedAt = now;
    this.rest = took * this.o.restFraction;
    if (this.shared || took <= this.o.slowMs) return null;
    if (++this.slow < this.o.slowLimit || this.off) return null;
    this.off = `Live previews are off for this talk: this computer took ${(took / 1000).toFixed(1)} s to write one down, too long to keep up. The words still arrive when you pause.`;
    return this.off;
  }

  /** A new utterance: the first preview waits for startVoicedS again, not for the interval. */
  utteranceEnded(): void {
    this.share();
    this.startedAt = -Infinity;
    this.endedAt = -Infinity;
    this.rest = 0;
  }
}
