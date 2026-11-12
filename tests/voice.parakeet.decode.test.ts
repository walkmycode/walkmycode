// Speech to text on this computer, for real (docs/VOICE.md §4d):
//  - a real .tar.bz2 (tests/fixtures/voice/tiny-model.tar.bz2, four tiny
//    files and a test recording) goes through the real bzip2 decompressor and
//    the safe extraction, as a download would;
//  - when the speech model is on this machine (iReliabee's copy or
//    WalkMyCode's own) and sherpa-onnx-node loads, the model's own test
//    recording is streamed through the stream route in 0.2 s pieces, in real
//    time, as the page sends a microphone, and the words must come back:
//    previews while it is spoken, then the final text. Skipped elsewhere (CI
//    has no 630 MB model).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { guarded } from "../src/lib/providers/guard";
import { engineAvailable, engineStatus, preload } from "../src/lib/voice/parakeet/engine";
import { bunzip, findModel, installModel } from "../src/lib/voice/parakeet/model";
import { resetParakeetRoutes, streamHandler } from "../src/lib/voice/parakeet/routes";
import type { SttEvent } from "../src/lib/voice/parakeet/session";
import { extractWanted } from "../src/lib/voice/parakeet/tar";

const FIXTURE = join(__dirname, "fixtures", "voice", "tiny-model.tar.bz2");
const WANT = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"] as const;

describe("Parakeet: a real .tar.bz2 through the real decompressor", () => {
  const dir = mkdtempSync(join(tmpdir(), "walkmycode-bz2-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("unpacks only the four files", async () => {
    const written = await extractWanted(bunzip(FIXTURE), { dest: dir, want: WANT, top: "tiny-model" });
    assert.deepEqual(written.sort(), [...WANT].sort());
    assert.deepEqual(readdirSync(dir).sort(), [...WANT].sort(), "the test recording and the folders stay in the archive");
    assert.equal(readFileSync(join(dir, "tokens.txt"), "utf8"), "<blk> 0\n▁the 1\n");
    assert.equal(readFileSync(join(dir, "encoder.int8.onnx")).length, 20000);
  });

  it("installs from a download of it: size and SHA-256 checked, then moved into place", async () => {
    const bytes = readFileSync(FIXTURE);
    const own = join(dir, "models");
    const where = await installModel({
      dirs: { own, ireliabee: "" },
      model: { name: "tiny-model", url: "https://example.test/tiny-model.tar.bz2", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), files: WANT },
      fetch: async () => new Response(new Uint8Array(bytes)),
      needed: 1,
    });
    assert.deepEqual(readdirSync(where).sort(), [...WANT].sort());
    assert.deepEqual(readdirSync(own), ["tiny-model"]);
  });

  it("says so when the archive is not bzip2", async () => {
    await assert.rejects(extractWanted(bunzip(join(__dirname, "voice.parakeet.decode.test.ts")), { dest: mkdtempSync(join(dir, "bad-")), want: WANT, top: "tiny-model" }), /couldn't be decompressed|damaged|ends in the middle/);
  });
});

/** A 16-bit mono 16 kHz WAV's samples. */
function wavPcm(path: string): Int16Array {
  const b = readFileSync(path);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  let at = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(at + 10);
      rate = b.readUInt32LE(at + 12);
      bits = b.readUInt16LE(at + 22);
    } else if (id === "data") {
      assert.deepEqual([rate, channels, bits], [16000, 1, 16], "the test recording is 16 kHz mono 16-bit");
      const n = Math.min(size, b.length - at - 8) >> 1;
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(at + 8 + i * 2);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("Parakeet: the model's own recording through the stream route", async () => {
  const found = findModel();
  const wavs = found ? join(found.dir, "test_wavs") : "";
  const wav = wavs && existsSync(wavs) ? readdirSync(wavs).find((f) => f.endsWith(".wav")) : undefined;
  const ready = !!found && !!wav && (await engineAvailable());
  const skip = ready ? false : "the speech model (with its test_wavs) or sherpa-onnx-node is not on this machine";

  it("loads the model once, and writes down what is said: previews, then the final text", { skip, timeout: 120_000 }, async () => {
    resetParakeetRoutes();
    await preload();
    const status = engineStatus();
    assert.equal(status.state, "ready");
    console.log(`    model loaded in ${status.loadMs} ms from ${found!.source}'s copy, ${status.threads} threads`);

    const pcm = wavPcm(join(wavs, wav!));
    const seconds = pcm.length / 16000;
    const h = guarded(streamHandler());
    const session = "decode-test-0001";
    const post = async (body: Record<string, unknown>) => {
      const res = await h(new Request("http://localhost:3000/api/voice/parakeet/stream", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ session, ...body }) }));
      assert.equal(res.status, 200, await res.clone().text());
      return ((await res.json()) as { events: SttEvent[] }).events;
    };
    // The recording, then 1.6 s of room noise so the 1.2 s of silence ends it, 0.2 s every 0.2 s.
    const tail = new Int16Array(1.6 * 16000);
    for (let i = 0; i < tail.length; i++) tail[i] = Math.round((Math.random() * 2 - 1) * 6);
    const all = new Int16Array(pcm.length + tail.length);
    all.set(pcm);
    all.set(tail, pcm.length);
    const seen: (SttEvent & { at: number })[] = [];
    const t0 = Date.now();
    for (let i = 0; i < all.length; i += 3200) {
      const piece = all.subarray(i, i + 3200);
      const events = await post({ pcm_base64: Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString("base64") });
      for (const e of events) seen.push({ ...e, at: (Date.now() - t0) / 1000 });
      const due = t0 + ((i + 3200) / 16000) * 1000;
      if (due > Date.now()) await sleep(due - Date.now());
    }
    // The final may still be decoding: ask until it is in.
    for (let i = 0; i < 100 && !seen.some((e) => e.type === "final"); i++) {
      await sleep(100);
      for (const e of await post({})) seen.push({ ...e, at: (Date.now() - t0) / 1000 });
    }
    await post({ close: true });

    const types = seen.map((e) => e.type);
    assert.equal(types[0], "speech", types.join(","));
    const partials = seen.filter((e) => e.type === "partial");
    const final = seen.find((e) => e.type === "final");
    assert.ok(final && final.type === "final", `a final arrived: ${types.join(",")}`);
    // On a busy machine (the whole test run at once) previews may be slow, and say so: that is a notice, never an error.
    assert.ok(partials.length >= 2, `previews arrived while it was spoken: ${partials.length}`);
    assert.ok(partials[0].at < 4, `the first preview came early: ${partials[0].at.toFixed(1)} s`);
    assert.ok(!seen.some((e) => e.type === "error"), JSON.stringify(seen.filter((e) => e.type === "error")));
    const notice = seen.find((e) => e.type === "notice");
    if (notice?.type === "notice") console.log(`    notice: ${notice.message}`);
    console.log(`    ${seconds.toFixed(1)} s of speech: ${partials.length} previews (first at ${partials[0].at.toFixed(1)} s), final decoded in ${final.ms} ms`);
    console.log(`    final: ${JSON.stringify(final.text)}`);
    // LibriSpeech, the recording the model ships with.
    const said = final.text.toLowerCase();
    for (const words of ["i don't wish to see it any more", "turning away her eyes", "it is certainly very like the old portrait"]) assert.ok(said.includes(words), `"${words}" in: ${final.text}`);
    assert.ok(final.ms < 10_000, `a final for ${seconds.toFixed(1)} s of speech in under 10 s: ${final.ms} ms`);
    // The previews are the start of it, growing.
    const first = partials[0];
    assert.ok(first.type === "partial" && /well|wish/i.test(first.text), `the first preview is the start of the sentence: ${first.type === "partial" ? first.text : ""}`);
  });

  it("push-to-talk: a short clip let go at once still comes back (the drain)", { skip, timeout: 60_000 }, async () => {
    const pcm = wavPcm(join(wavs, wav!)).subarray(0, 2.2 * 16000); // "Well, I don't wish to see it…", cut off mid-sentence
    const h = guarded(streamHandler());
    const post = async (body: Record<string, unknown>) => {
      const res = await h(new Request("http://localhost:3000/api/voice/parakeet/stream", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ session: "decode-test-0002", ...body }) }));
      return ((await res.json()) as { events: SttEvent[] }).events;
    };
    const events: SttEvent[] = [];
    for (let i = 0; i < pcm.length; i += 3200) {
      const piece = pcm.subarray(i, i + 3200);
      events.push(...(await post({ pcm_base64: Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString("base64") })));
    }
    assert.ok(!events.some((e) => e.type === "final"), "no silence yet: nothing final");
    events.push(...(await post({ flush: true })));
    const final = events.find((e) => e.type === "final");
    assert.ok(final?.type === "final" && /i don't wish/i.test(final.text), `the drain decoded it: ${JSON.stringify(events.map((e) => e.type))} ${final?.type === "final" ? final.text : ""}`);
    console.log(`    2.2 s let go at once: ${JSON.stringify(final.text)} in ${final.ms} ms`);
  });
});
