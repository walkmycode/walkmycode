// The Learn professor's read-only look at the computer (src/lib/pcFiles.ts) on a made-up folder tree: what a search
// finds and what it never does (secrets, programs, caches), a document read page by page, the ~ path the chat shows,
// and the route (src/lib/providers/learn.ts) running his tools inside one answer, with a fake Anthropic replaying a
// real tool-use exchange.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { readNote } from "../src/learn/lib/chat";
import { findFiles, isSecret, lookNote, pcRefusal, readDocument, READ_CHARS, shortPath } from "../src/lib/pcFiles";
import { configPath, saveConfig } from "../src/lib/providers/config";
import { guarded } from "../src/lib/providers/guard";
import { keysPath, writeKey } from "../src/lib/providers/keys";
import { learnHandler } from "../src/lib/providers/learn";
import type { FetchLike } from "../src/lib/providers/sdk";
import type { StreamEvent } from "../src/lib/providers/wire";

/** A PDF of these pages, written by hand: enough for a real PDF reader to find each page's text. */
function pdf(pages: string[][]): Buffer {
  const n = pages.length;
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((lines, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ")} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objects.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

let root: string;
const at = (...p: string[]) => join(root, ...p);
const put = (path: string, body: string | Buffer) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
};

before(() => {
  root = mkdtempSync(join(tmpdir(), "walkmycode-pc-"));
  put(at("Documents", "Papers", "Attention Is All You Need.pdf"), pdf([["Attention Is All You Need"], ["We propose the Transformer."]]));
  put(at("Documents", "attention-notes.md"), "# Notes on attention\n\nSelf-attention compares every word with every other.");
  put(at("Downloads", "attention data.csv"), "a,b\n1,2");
  put(at("projects", "app", "node_modules", "attention", "README.md"), "a package, not a paper");
  put(at("projects", "app", ".env"), "ATTENTION_KEY=sk-secret");
  put(at("projects", "app", "keys.env"), "ANTHROPIC_API_KEY=sk-ant-secret");
  put(at(".ssh", "attention_id_rsa"), "PRIVATE");
  put(at("AppData", "Local", "Browser", "attention cookies.txt"), "cookie");
  put(at("Documents", "long.txt"), "x".repeat(READ_CHARS + 10));
  put(at("Documents", "binary.txt"), Buffer.from([65, 0, 66]));
});

after(() => rmSync(root, { recursive: true, force: true }));

describe("what is a secret", () => {
  it("keys, credentials and the folders that hold them; never an ordinary document", () => {
    for (const p of [at(".env"), at("app", ".env.local"), at("keys.env"), at("x.pem"), at("vault.kdbx"), at(".ssh", "notes.txt"), at(".aws", "config"), at("AppData", "Roaming", "x", "Login Data"), at(".config", "gh", "hosts.yml"), at("id_ed25519"), at(".npmrc"), at("credentials.json")]) assert.ok(isSecret(p), p);
    for (const p of [at("Documents", "paper.pdf"), at("env-notes.md"), at("keys and locks.docx"), at(".config", "app.json"), join("C:", "Users", "a", "AppData", "Local", "Temp", "attachment.pdf")]) assert.ok(!isSecret(p), p);
    assert.ok(isSecret(join("C:", "Users", "a", "AppData", "Local", "Temp", "x", "AppData", "Local", "Google", "Login Data")), "app data inside Temp is still app data");
  });
});

describe("finding files by name", () => {
  it("finds documents with every word in the name, PDFs first, and never secrets, packages or app data", async () => {
    const r = await findFiles("attention", { roots: [root] });
    const names = r.files.map((f) => f.path.slice(root.length + 1).replace(/\\/g, "/"));
    assert.deepEqual(names, ["Documents/Papers/Attention Is All You Need.pdf", "Documents/attention-notes.md"]);
    assert.equal(r.partial, false);
    // Any kind: the data file too, still no secrets.
    const any = (await findFiles("attention", { roots: [root], kind: "any" })).files.map((f) => f.path.slice(root.length));
    assert.ok(any.some((p) => p.endsWith("attention data.csv")));
    assert.ok(!any.some((p) => /node_modules|\.env|keys\.env|\.ssh|AppData/.test(p)), any.join("\n"));
    // Every word, any order and case.
    assert.equal((await findFiles("NEED attention", { roots: [root] })).files.length, 1);
    assert.equal((await findFiles("a", { roots: [root] })).files.length, 0, "too short to search by");
  });

  it("stops at its time limit and says so", async () => {
    let t = 0;
    const r = await findFiles("attention", { roots: [root], deadlineMs: 1, now: () => (t += 5) });
    assert.equal(r.partial, true);
  });
});

describe("reading a document", () => {
  it("reads a PDF page by page, marking each page, from a page asked for", async () => {
    const p = at("Documents", "Papers", "Attention Is All You Need.pdf");
    const r = await readDocument(p);
    if ("unreadable" in r) return assert.fail(r.unreadable);
    assert.equal(r.kind, "pdf");
    assert.deepEqual([r.pages, r.from, r.to, r.more], [2, 1, 2, false]);
    assert.match(r.text, /^\[page 1\]\nAttention Is All You Need[\s\S]*\[page 2\]\nWe propose the Transformer\.$/);
    const two = await readDocument(p, 2);
    if ("unreadable" in two) return assert.fail(two.unreadable);
    assert.match(two.text, /^\[page 2\]/);
  });

  it("reads long text in parts, and the ~ path the chat shows", async () => {
    const first = await readDocument("~/Documents/long.txt", 1, root);
    if ("unreadable" in first) return assert.fail(first.unreadable);
    assert.deepEqual([first.text.length, first.pages, first.more], [READ_CHARS, 2, true]);
    const second = await readDocument(at("Documents", "long.txt"), 2);
    if ("unreadable" in second) return assert.fail(second.unreadable);
    assert.deepEqual([second.text.length, second.more], [10, false]);
  });

  it("never reads a secret, a relative path, a missing file, a folder or a binary file", async () => {
    const why = async (p: string) => {
      const r = await readDocument(p);
      return "unreadable" in r ? r.unreadable : "read";
    };
    assert.match(await why(at("projects", "app", ".env")), /secret/);
    assert.match(await why(at("projects", "app", "keys.env")), /secret/);
    assert.match(await why(at(".ssh", "attention_id_rsa")), /secret/);
    assert.match(await why("Documents/attention-notes.md"), /full path/);
    assert.match(await why(at("nope.pdf")), /not there/);
    assert.match(await why(at("Documents")), /folder/);
    assert.match(await why(at("Documents", "binary.txt")), /not text/);
  });

  it("is refused on a hosted server", () => {
    assert.match(pcRefusal({ WALKMYCODE_MODE: "hosted" }) ?? "", /server, not on your computer/);
    assert.equal(pcRefusal({}), null);
  });
});

describe("what the chat shows and remembers", () => {
  it("says each look in a line, with the home folder as ~", () => {
    assert.deepEqual(lookNote("find_files", { query: "attention" }, { files: [1, 2, 3] }), { tool: "find", what: "attention", note: "3 files found" });
    assert.deepEqual(lookNote("find_files", { query: "zzz" }, { files: [] }), { tool: "find", what: "zzz", note: "nothing found" });
    assert.equal(lookNote("read_document", { path: join(root, "a.pdf") }, { path: "", kind: "pdf", pages: 12, from: 1, to: 12, text: "", more: false }).note, "pages 1–12 of 12");
    assert.equal(lookNote("read_document", { path: join(root, "a.pdf") }, { path: "", kind: "pdf", pages: 12, from: 3, to: 3, text: "", more: true }).note, "page 3 of 12");
    assert.equal(shortPath(join(root, "Documents", "a.pdf"), root), `~${sep}Documents${sep}a.pdf`);
    assert.equal(shortPath("D:\\other\\a.pdf", root), "D:\\other\\a.pdf");
  });

  it("remembers which documents an answer read, for the next question", () => {
    assert.equal(readNote({ looked: [{ tool: "find", what: "attention", note: "1 file found" }, { tool: "read", what: "~/Papers/a.pdf", note: "pages 1–2 of 2" }] }), "[Read on the computer: ~/Papers/a.pdf (pages 1–2 of 2)]\n\n");
    assert.equal(readNote({}), "");
  });
});

// ── The route: his tools run inside one answer ──

type Frame = [string, Record<string, unknown>];
const sse = (frames: Frame[]) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`).join("");
const start = (id: string): Frame => ["message_start", { message: { id, type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }];

describe("POST /api/learn with pc", () => {
  const ENV = ["WALKMYCODE_PROVIDER", "WALKMYCODE_MODEL", "ANTHROPIC_API_KEY", "WALKMYCODE_MODE"];
  let home: string;
  before(() => {
    home = mkdtempSync(join(tmpdir(), "walkmycode-learn-pc-"));
    process.env.WALKMYCODE_HOME = home;
  });
  beforeEach(() => {
    for (const v of ENV) delete process.env[v];
    rmSync(configPath(), { force: true });
    rmSync(keysPath(), { force: true });
  });
  after(() => {
    for (const v of ENV) delete process.env[v];
    delete process.env.WALKMYCODE_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the document he asks for, streams the look, and answers from it in the same request", async () => {
    saveConfig({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "low" });
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const paper = at("Documents", "Papers", "Attention Is All You Need.pdf");
    const bodies: Record<string, unknown>[] = [];
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const frames: Frame[] =
        bodies.length === 1
          ? [start("m1"), ["content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "read_document", input: {} } }], ["content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: paper }) } }], ["content_block_stop", { index: 0 }], ["message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } }], ["message_stop", {}]]
          : [start("m2"), ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }], ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "It proposes the Transformer (p. 2)." } }], ["content_block_stop", { index: 0 }], ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 9 } }], ["message_stop", {}]];
      return new Response(sse(frames), { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const res = await guarded(learnHandler({ fetch }))(new Request("http://localhost:3000/api/learn", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ input: "Review the attention paper on my PC.", pc: true }) }));
    const evs = (await res.text()).split("\n\n").filter((f) => f.startsWith("data:")).map((f) => JSON.parse(f.slice(5)) as StreamEvent);
    const looks = evs.filter((e) => e.type === "look");
    assert.deepEqual(looks.map((e) => (e.type === "look" ? [e.tool, e.done, e.note ?? null] : null)), [
      ["read", false, null],
      ["read", true, "pages 1–2 of 2"],
    ]);
    assert.equal(evs.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : "")).join(""), "It proposes the Transformer (p. 2).");
    // The first request offers both tools and says what he may do; the second carries the page text back.
    assert.deepEqual(((bodies[0].tools as { name: string }[]) ?? []).map((t) => t.name), ["find_files", "read_document"]);
    assert.match(JSON.stringify(bodies[0].system), /read only/);
    assert.match(JSON.stringify(bodies[1].messages), /\[page 2\][^"]*We propose the Transformer/);
  });

  it("offers no tools for a lesson (json), or on a hosted server", async () => {
    saveConfig({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "low" });
    writeKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const bodies: Record<string, unknown>[] = [];
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(sse([start("m"), ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }], ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "{}" } }], ["content_block_stop", { index: 0 }], ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }], ["message_stop", {}]]), { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const ask = (body: Record<string, unknown>) => guarded(learnHandler({ fetch }))(new Request("http://localhost:3000/api/learn", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.text());
    await ask({ input: "Write the lesson.", json: true, pc: true });
    process.env.WALKMYCODE_MODE = "hosted";
    await ask({ input: "Find my paper.", pc: true });
    assert.deepEqual(bodies.map((b) => b.tools), [undefined, undefined]);
  });
});
