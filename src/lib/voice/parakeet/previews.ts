// When to decode a live preview while someone is still speaking (docs/VOICE.md
// §4d). Pure: the session asks due() as audio arrives and tells it when a
// preview began and ended.
//
// - A preview re-decodes the last WINDOW_S seconds, every INTERVAL_MS, once
//   START_VOICED_S of speech has been heard.
// - A tick is skipped while the last preview is still running.
// - A preview that takes more than SLOW_FRACTION of the interval is slow; the
//   second slow one turns previews off for the session, with the reason, so a
//   slow computer spends its time on the final text instead.

export interface PreviewOptions {
  intervalMs: number;
  /** Voiced audio heard before the first preview, in seconds. */
  startVoicedS: number;
  /** How much of the utterance's end a preview decodes, in seconds. */
  windowS: number;
  slowFraction: number;
  /** This many slow previews turn them off. */
  slowLimit: number;
}

export const PREVIEW_DEFAULTS: PreviewOptions = { intervalMs: 1000, startVoicedS: 0.8, windowS: 8, slowFraction: 0.7, slowLimit: 2 };

export class PreviewScheduler {
  readonly o: PreviewOptions;
  /** Why previews are off for this session, or null while they are on. */
  off: string | null = null;
  private running = false;
  private startedAt = -Infinity;
  private began = 0;
  private slow = 0;

  constructor(o: Partial<PreviewOptions> = {}) {
    this.o = { ...PREVIEW_DEFAULTS, ...o };
  }

  /** Whether a preview should start now. */
  due(now: number, heard: { speaking: boolean; voicedS: number }): boolean {
    if (this.off || this.running || !heard.speaking) return false;
    if (heard.voicedS < this.o.startVoicedS) return false;
    return now - this.startedAt >= this.o.intervalMs;
  }

  begin(now: number): void {
    this.running = true;
    this.startedAt = now;
    this.began = now;
  }

  /** The preview that began is over. Returns the reason when this one turned previews off. */
  finish(now: number): string | null {
    if (!this.running) return null;
    this.running = false;
    const took = now - this.began;
    if (took <= this.o.intervalMs * this.o.slowFraction) return null;
    if (++this.slow < this.o.slowLimit || this.off) return null;
    this.off = `Live previews are off for this talk: this computer took ${(took / 1000).toFixed(1)} s to write one down, too long to keep up. The words still arrive when you pause.`;
    return this.off;
  }

  /** A new utterance: the first preview waits for startVoicedS again, not for the interval. */
  utteranceEnded(): void {
    this.startedAt = -Infinity;
  }
}
