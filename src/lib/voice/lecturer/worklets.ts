// The two AudioWorklet processors the Deepgram lecturer uses, as source text
// (loaded from a Blob URL, so they work wherever the page does, Lite's asset
// paths included). Tests run this very text in a VM.
//
// lantern-mic: the microphone, at the AudioContext's rate, averaged down to
// 16 kHz and sent as 16-bit little-endian PCM in 20 ms frames (640 bytes).
//
// lantern-player: a queue of the agent's 24 kHz 16-bit PCM, played at the
// context's rate with linear interpolation; "flush" empties it at once
// (barge-in) and "drained" is posted when it runs dry after playing.

export const MIC_PROCESSOR = "lantern-mic";
export const PLAYER_PROCESSOR = "lantern-player";
export const MIC_RATE = 16000;
export const AGENT_RATE = 24000;
/** Samples per microphone frame: 20 ms at 16 kHz. */
export const MIC_FRAME = 320;

export const WORKLET_SOURCE = `
class LanternMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${MIC_RATE};
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(${MIC_FRAME});
    this.k = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i];
      this.count++;
      this.phase += 1;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        let v = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        if (v > 1) v = 1;
        else if (v < -1) v = -1;
        this.out[this.k++] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
        if (this.k === this.out.length) {
          const frame = this.out.buffer;
          this.port.postMessage(frame, [frame]);
          this.out = new Int16Array(${MIC_FRAME});
          this.k = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("${MIC_PROCESSOR}", LanternMic);

class LanternPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.pos = 0;
    this.step = ${AGENT_RATE} / sampleRate;
    this.playing = false;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === "pcm" && d.data) this.queue.push(new Int16Array(d.data));
      else if (d.type === "flush") {
        this.queue = [];
        this.cur = null;
        this.pos = 0;
        this.playing = false;
      }
    };
  }
  next() {
    while (this.cur && this.pos >= this.cur.length) {
      this.pos -= this.cur.length;
      this.cur = this.queue.length ? this.queue.shift() : null;
    }
    if (!this.cur && this.queue.length) {
      this.cur = this.queue.shift();
      this.pos = 0;
    }
    return this.cur;
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      const cur = this.next();
      if (!cur) {
        out.fill(0, i);
        if (this.playing) {
          this.playing = false;
          this.port.postMessage({ type: "drained" });
        }
        return true;
      }
      this.playing = true;
      const j = Math.floor(this.pos);
      const f = this.pos - j;
      const a = cur[j] / 32768;
      const nextSample = j + 1 < cur.length ? cur[j + 1] : this.queue.length ? this.queue[0][0] : cur[j];
      const b = nextSample / 32768;
      out[i] = a + (b - a) * f;
      this.pos += this.step;
    }
    return true;
  }
}
registerProcessor("${PLAYER_PROCESSOR}", LanternPlayer);
`;
