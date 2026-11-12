// Claude's narration, in order (docs/MCP.md §3 narrate): Claude says a sentence
// or two at a time as it works, each arriving as its own command, and the page
// reads them one after another with whichever narrator is in force. The next
// chunk's audio is fetched while one plays, so the joins have no gap. A new
// question (the user presses Talk) clears what was still to be said.
// No DOM here: the narrator comes from a getter, so tests hand in a fake.

/** What the queue needs of a narrator (src/lib/voice/narrate.ts). */
export interface QueueNarrator {
  speak(text: string): Promise<"ended" | "stopped">;
  prefetch(text: string): Promise<void>;
  stop(): void;
}

export interface QueueOptions {
  onError?: (e: unknown) => void;
  /** True while something is being read, false once the queue has run dry. */
  onSpeaking?: (on: boolean) => void;
  /** What a chunk becomes before it is read (paths and markup made speakable). */
  prepare?: (text: string) => string;
}

export class NarrationQueue {
  private items: string[] = [];
  private busy = false;
  private gen = 0;
  private current: QueueNarrator | null = null;
  /** Chunks already being fetched ahead, so none is asked for twice. */
  private ahead = new Set<string>();

  constructor(
    private readonly narrator: () => Promise<QueueNarrator>,
    private readonly o: QueueOptions = {},
  ) {}

  /** Chunks waiting or being read. */
  get length(): number {
    return this.items.length + (this.busy ? 1 : 0);
  }

  /** Queue a chunk to be read after the ones before it; how many are ahead of it. */
  push(text: string): number {
    const t = (this.o.prepare ?? ((s: string) => s.trim()))(text);
    if (!t) return this.length;
    const ahead = this.length;
    this.items.push(t);
    if (this.busy && this.current) this.prefetch(this.current, t);
    else if (!this.busy) void this.pump();
    return ahead;
  }

  /** Stop reading and forget what was still to be said. */
  clear(): void {
    this.gen++;
    this.items = [];
    this.ahead.clear();
    this.current?.stop();
  }

  private prefetch(n: QueueNarrator, text: string): void {
    if (this.ahead.has(text)) return;
    this.ahead.add(text);
    void n.prefetch(text).catch(() => {});
  }

  private async pump(): Promise<void> {
    this.busy = true;
    this.o.onSpeaking?.(true);
    const my = this.gen;
    try {
      while (this.items.length && my === this.gen) {
        const text = this.items.shift()!;
        this.ahead.delete(text);
        let n: QueueNarrator;
        try {
          n = await this.narrator();
        } catch (e) {
          this.o.onError?.(e);
          continue;
        }
        if (my !== this.gen) break;
        this.current = n;
        if (this.items[0]) this.prefetch(n, this.items[0]);
        try {
          await n.speak(text);
        } catch (e) {
          this.o.onError?.(e);
        }
      }
    } finally {
      this.busy = false;
      this.current = null;
      // Cleared while reading, and given more since: start again for the new chunks.
      if (this.items.length) void this.pump();
      else this.o.onSpeaking?.(false);
    }
  }
}
