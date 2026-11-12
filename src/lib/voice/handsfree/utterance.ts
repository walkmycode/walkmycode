// Turning a stream of heard words into utterances (docs/VOICE.md §4c), pure.
//
// Transcript: the browser's speech recognition, run continuously, keeps one
// growing list of results (interim ones still changing, final ones fixed).
// Each utterance is the part of that list not yet taken; what the
// recognition heard while our own voice played (its echo) is dropped.
//
// pcmToWav: an utterance's 16 kHz linear16 frames as a WAV file, for the
// user's Groq, Deepgram or ElevenLabs key to transcribe when the browser cannot or is not chosen.

export interface HeardResult {
  text: string;
  final: boolean;
}

export class Transcript {
  private results: HeardResult[] = [];
  private from = 0;

  /** The recognizer's whole result list, as it stands now. */
  update(results: HeardResult[]): void {
    this.results = results;
    if (this.from > results.length) this.from = results.length;
  }

  /** The words of the utterance so far. */
  text(): string {
    return this.results
      .slice(this.from)
      .map((r) => r.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** The last result heard is final (the recognizer thinks the phrase is over). */
  settled(): boolean {
    const last = this.results.at(-1);
    return this.results.length > this.from && !!last?.final;
  }

  /** The utterance's words; what comes next starts a new one. */
  take(): string {
    const t = this.text();
    this.from = this.results.length;
    return t;
  }

  /**
   * Forget what was heard: all of it, or (`keepInterim`) only the finished
   * phrases, keeping the one still being heard (it may be the user cutting in).
   */
  drop(keepInterim = false): void {
    if (!keepInterim) {
      this.from = this.results.length;
      return;
    }
    let i = this.results.length;
    while (i > this.from && !this.results[i - 1].final) i--;
    this.from = i;
  }

  /** The recognizer started a new session: its list starts empty again. */
  restart(): void {
    this.results = [];
    this.from = 0;
  }
}

/** 16-bit mono PCM frames as a WAV file. */
export function pcmToWav(frames: Int16Array[], sampleRate = 16000): Uint8Array {
  const samples = frames.reduce((n, f) => n + f.length, 0);
  const data = samples * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, data, true);
  let at = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++, at += 2) v.setInt16(at, f[i], true);
  }
  return out;
}
