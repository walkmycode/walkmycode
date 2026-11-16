// The live debugger on this computer (src/lib/localrun/debug/): the DAP framing, the zip unpacker, the
// installer's checksum, Rust's names and cargo's targets; and, where CodeLLDB and Rust are installed, a whole
// session through the local-run hub: build, stop at a breakpoint, read variables, step, and end.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { crc32 } from "node:zlib";
import { adapterReady, CODELLDB, type Adapter } from "../src/lib/localrun/debug/adapters";
import { DapReader, frame } from "../src/lib/localrun/debug/dap";
import { installAdapter } from "../src/lib/localrun/debug/install";
import { cargoExecutable, cargoTarget, prettyRustType, prettyRustValue } from "../src/lib/localrun/debug/session";
import { unzipTo, zipEntries } from "../src/lib/localrun/debug/zip";
import { createLocalRun } from "../src/lib/localrun/hub";
import { locateIn } from "../src/lib/localrun/run";
import type { ServerMsg } from "../src/lib/localrun/protocol";

/** A small stored (uncompressed) zip, for the unpacker and the installer. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe("the Debug Adapter Protocol's framing", () => {
  it("reads whole messages however the bytes are split, and skips a bad header", () => {
    const got: unknown[] = [];
    const r = new DapReader((m) => got.push(m));
    const a = frame({ seq: 1, type: "event", event: "stopped", body: { reason: "breakpoint" } });
    const b = frame({ seq: 2, type: "response", request_seq: 7, success: true, body: { text: "é ünïcode" } });
    const all = Buffer.concat([Buffer.from("X-Junk: 1\r\n\r\n"), a, b]);
    for (let i = 0; i < all.length; i += 7) r.push(all.subarray(i, i + 7));
    assert.deepEqual(got, [
      { seq: 1, type: "event", event: "stopped", body: { reason: "breakpoint" } },
      { seq: 2, type: "response", request_seq: 7, success: true, body: { text: "é ünïcode" } },
    ]);
  });
});

describe("unpacking a debugger", () => {
  it("unpacks the entries under a prefix, and refuses a path that leaves the folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "wmc-zip-"));
    try {
      const zip = makeZip({ "extension/adapter/codelldb": "bin", "extension/lldb/lib/x.py": "py", "other/skip.txt": "no" });
      assert.deepEqual(zipEntries(zip).map((e) => e.name), ["extension/adapter/codelldb", "extension/lldb/lib/x.py", "other/skip.txt"]);
      assert.equal(unzipTo(zip, dir, "extension/"), 2);
      assert.equal(readFileSync(join(dir, "adapter", "codelldb"), "utf8"), "bin");
      assert.equal(existsSync(join(dir, "skip.txt")), false);
      assert.throws(() => unzipTo(makeZip({ "extension/../../evil.txt": "x" }), dir, "extension/"), /outside its folder/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs only what matches its published checksum, and marks it ready only when whole", async () => {
    const home = mkdtempSync(join(tmpdir(), "wmc-home-"));
    try {
      const zip = makeZip({ "extension/adapter/codelldb.exe": "x", "extension/adapter/codelldb": "x" });
      const fake = (sha: string): Adapter => ({ ...CODELLDB, assets: { "test-x64": { url: "https://example.invalid/a.vsix", sha256: sha, bytes: zip.length } } });
      const good = createHash("sha256").update(zip).digest("hex");
      await assert.rejects(installAdapter(fake("0".repeat(64)), () => {}, { home, key: "test-x64", fetchBytes: async () => zip }), /checksum/);
      assert.equal(adapterReady(fake(good), home), false, "a tampered download leaves nothing that runs");
      const phases: string[] = [];
      await installAdapter(fake(good), (p) => phases.push(p.phase), { home, key: "test-x64", fetchBytes: async (_u, on) => (on(zip.length), zip) });
      assert.deepEqual([...new Set(phases)], ["download", "check", "unpack"]);
      assert.equal(adapterReady(fake(good), home), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Rust, as the panel shows it", () => {
  it("names types the way they were written", () => {
    assert.equal(prettyRustType("alloc::vec::Vec<i32,alloc::alloc::Global>"), "Vec<i32>");
    assert.equal(prettyRustType("alloc::string::String"), "String");
    assert.equal(prettyRustType("main::Order"), "Order");
    assert.equal(prettyRustType("ref$<str$>"), "&str");
    assert.equal(prettyRustType("core::option::Option<ref$<main::Order> >"), "Option<&Order >");
    assert.equal(prettyRustValue("size=3"), "len 3");
  });

  it("builds the file's own cargo target, and finds the program cargo built for it", () => {
    const crate = join("C:", "p", "rust");
    assert.deepEqual(cargoTarget(join(crate, "examples", "borrowing_rules.rs"), crate), ["--example", "borrowing_rules"]);
    assert.deepEqual(cargoTarget(join(crate, "src", "bin", "tool.rs"), crate), ["--bin", "tool"]);
    assert.deepEqual(cargoTarget(join(crate, "src", "main.rs"), crate), []);
    const file = join(crate, "examples", "borrowing_rules.rs");
    const json = [
      '{"reason":"compiler-artifact","target":{"src_path":"' + join(crate, "src", "lib.rs").replace(/\\/g, "\\\\") + '"},"executable":null}',
      "   Compiling ownership v0.1.0",
      '{"reason":"compiler-artifact","target":{"src_path":"' + join(crate, "src", "main.rs").replace(/\\/g, "\\\\") + '"},"executable":"main.exe"}',
      '{"reason":"compiler-artifact","target":{"src_path":"' + file.replace(/\\/g, "\\\\") + '"},"executable":"borrowing_rules.exe"}',
    ].join("\n");
    assert.equal(cargoExecutable(json, file), "borrowing_rules.exe");
    assert.equal(cargoExecutable(json, join(crate, "src", "other.rs")), "main.exe");
  });
});

// A real session: only where CodeLLDB has been fetched and Rust is installed (the owner's computer; never CI).
const live = adapterReady(CODELLDB) && !!process.env.PATH?.split(process.platform === "win32" ? ";" : ":").some((d) => existsSync(join(d, process.platform === "win32" ? "rustc.exe" : "rustc")));

describe("debugging Rust on this computer", { skip: live ? false : "CodeLLDB or Rust isn't installed here" }, () => {
  it("builds it, stops at the breakpoint, shows and opens the variables, steps, and ends", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wmc-dbg-"));
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, JSON.stringify({ local_run: { allowed: true, allowed_at: new Date().toISOString(), timeout_s: 60 } }));
    const code = ["struct Order { item: String, qty: u32 }", "", "fn main() {", "    let mut v = vec![1, 2, 3];", "    let first = v[0];", "    v.push(4);", "    let o = Order { item: String::from(\"ink\"), qty: 2 };", '    println!("{first} {} {} {}", v.len(), o.item, o.qty);', "}", ""].join("\n");
    const lr = createLocalRun({ configFile: () => configFile });
    const got: ServerMsg[] = [];
    let wake: () => void = () => {};
    const conn = lr.connect({ send: (m) => (got.push(m), wake()), close: () => {} })!;
    const next = (pred: (m: ServerMsg) => boolean, ms = 90_000) =>
      new Promise<ServerMsg>((done, fail) => {
        const t = setTimeout(() => fail(new Error(`timed out; got ${got.map((m) => m.type).join(",")}`)), ms);
        const look = () => {
          const i = got.findIndex(pred);
          if (i >= 0) {
            clearTimeout(t);
            done(got.splice(i, 1)[0]);
          }
        };
        wake = look;
        look();
      });
    try {
      conn.receive({ type: "debug-start", id: "d1", lang: "rust", code, path: "examples/order.rs", breakpoints: [6] });
      await next((m) => m.type === "debug-start");
      const p1 = (await next((m) => m.type === "debug-paused")) as Extract<ServerMsg, { type: "debug-paused" }>;
      const top = p1.view.frames[p1.view.frame];
      assert.equal(top.line, 6);
      assert.equal(top.mine, true);
      assert.equal(top.file, "examples/order.rs");
      const v = p1.view.vars.find((x) => x.name === "v")!;
      assert.equal(v.type, "Vec<i32>");
      assert.equal(v.value, "len 3");
      assert.ok(v.ref > 0);
      conn.receive({ type: "debug-vars", id: "d1", req: "r1", ref: v.ref });
      const kids = (await next((m) => m.type === "debug-vars")) as Extract<ServerMsg, { type: "debug-vars" }>;
      assert.deepEqual(kids.vars.map((k) => `${k.name}=${k.value}`), ["[0]=1", "[1]=2", "[2]=3"]);
      conn.receive({ type: "debug-cmd", id: "d1", cmd: "next" });
      const p2 = (await next((m) => m.type === "debug-paused")) as Extract<ServerMsg, { type: "debug-paused" }>;
      assert.equal(p2.view.frames[p2.view.frame].line, 7);
      assert.equal(p2.view.vars.find((x) => x.name === "v")?.value, "len 4");
      conn.receive({ type: "debug-cmd", id: "d1", cmd: "continue" });
      const exit = (await next((m) => m.type === "debug-exit")) as Extract<ServerMsg, { type: "debug-exit" }>;
      assert.equal(exit.code, 0);
      const printed = got.filter((m) => m.type === "debug-out").map((m) => (m as { text: string }).text).join("");
      assert.match(printed, /1 4 ink 2/);
    } finally {
      conn.closed();
      setTimeout(() => rmSync(dir, { recursive: true, force: true }), 1000);
    }
  });

  it("follows a step into another file of the project: the frame is that file, by its project path", async () => {
    const root = mkdtempSync(join(tmpdir(), "wmc-crate-"));
    const configFile = join(root, ".config.json");
    writeFileSync(configFile, JSON.stringify({ local_run: { allowed: true, allowed_at: new Date().toISOString(), timeout_s: 120 } }));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "Cargo.toml"), ["[package]", 'name = "shop"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"));
    const main = ["mod shop;", "", "fn main() {", "    let total = shop::price(3, 4);", '    println!("total {total}");', "}", ""].join("\n");
    writeFileSync(join(root, "src", "main.rs"), main);
    writeFileSync(join(root, "src", "shop.rs"), ["pub fn price(qty: u32, each: u32) -> u32 {", "    let sum = qty * each;", "    sum", "}", ""].join("\n"));
    const lr = createLocalRun({ configFile: () => configFile, locate: (p) => locateIn([root], [], p) });
    const got: ServerMsg[] = [];
    let wake: () => void = () => {};
    const conn = lr.connect({ send: (m) => (got.push(m), wake()), close: () => {} })!;
    const next = (pred: (m: ServerMsg) => boolean, ms = 180_000) =>
      new Promise<ServerMsg>((done, fail) => {
        const t = setTimeout(() => fail(new Error(`timed out; got ${got.map((m) => m.type).join(",")}`)), ms);
        const look = () => {
          const i = got.findIndex(pred);
          if (i >= 0) {
            clearTimeout(t);
            done(got.splice(i, 1)[0]);
          }
        };
        wake = look;
        look();
      });
    try {
      conn.receive({ type: "debug-start", id: "d2", lang: "rust", code: main, path: "src/main.rs", breakpoints: [4] });
      const p1 = (await next((m) => m.type === "debug-paused")) as Extract<ServerMsg, { type: "debug-paused" }>;
      assert.deepEqual([p1.view.frames[p1.view.frame].file, p1.view.frames[p1.view.frame].line], ["src/main.rs", 4]);
      conn.receive({ type: "debug-cmd", id: "d2", cmd: "stepIn" });
      const p2 = (await next((m) => m.type === "debug-paused")) as Extract<ServerMsg, { type: "debug-paused" }>;
      const f = p2.view.frames[p2.view.frame];
      assert.equal(f.file, "src/shop.rs", JSON.stringify(p2.view.frames.slice(0, 3)));
      assert.equal(f.mine, true);
      assert.ok(f.line >= 1 && f.line <= 3);
      assert.ok(p2.view.vars.some((v) => v.name === "qty" && v.value === "3"), JSON.stringify(p2.view.vars));
      // The caller is the frame below, in main.rs.
      assert.equal(p2.view.frames[p2.view.frame + 1]?.file, "src/main.rs");
      conn.receive({ type: "debug-cmd", id: "d2", cmd: "continue" });
      assert.equal(((await next((m) => m.type === "debug-exit")) as Extract<ServerMsg, { type: "debug-exit" }>).code, 0);
    } finally {
      conn.closed();
      setTimeout(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }), 1500);
    }
  });
});

/** A hub connection on a throwaway config where running code is allowed, and a way to wait for its messages. */
function hubFor(o: { locate?: (p: string) => ReturnType<typeof locateIn> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wmc-hub-"));
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, JSON.stringify({ local_run: { allowed: true, allowed_at: new Date().toISOString(), timeout_s: 120 } }));
  const lr = createLocalRun({ configFile: () => configFile, ...(o.locate ? { locate: o.locate } : {}) });
  const got: ServerMsg[] = [];
  let wake: () => void = () => {};
  const conn = lr.connect({ send: (m) => (got.push(m), wake()), close: () => {} })!;
  const next = (pred: (m: ServerMsg) => boolean, ms = 120_000) =>
    new Promise<ServerMsg>((done, fail) => {
      const t = setTimeout(() => fail(new Error(`timed out; got ${got.map((m) => m.type).join(",")}`)), ms);
      const look = () => {
        const i = got.findIndex(pred);
        if (i >= 0) {
          clearTimeout(t);
          done(got.splice(i, 1)[0]);
        }
      };
      wake = look;
      look();
    });
  const close = () => {
    conn.closed();
    setTimeout(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }), 1500);
  };
  return { conn, got, next, close };
}

describe("a program's input, on this computer", () => {
  it("Run: what the user types reaches the program, which waits for it rather than reading end-of-file", async () => {
    const h = hubFor();
    try {
      const code = "process.stdin.once('data', (d) => { console.log('got ' + String(d).trim()); process.exit(0); });\nconsole.log('ready');\n";
      h.conn.receive({ type: "run", id: "r1", lang: "javascript", code });
      await h.next((m) => m.type === "run-out" && /ready/.test((m as { text: string }).text));
      // Nothing typed yet: it is still waiting (no exit).
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(h.got.some((m) => m.type === "run-exit"), false, "it waits for its input");
      h.conn.receive({ type: "input", id: "r1", text: "teddy\n" });
      await h.next((m) => m.type === "run-out" && /got teddy/.test((m as { text: string }).text));
      assert.equal(((await h.next((m) => m.type === "run-exit")) as { code: number }).code, 0);
    } finally {
      h.close();
    }
  });
});

describe("debugging a program that reads input or prints in a loop", { skip: live ? false : "CodeLLDB or Rust isn't installed here" }, () => {
  it("the guessing game waits for its guess, and gets what the user types", async () => {
    const h = hubFor();
    const code = ["use std::io;", "fn main() {", "    loop {", '        println!("Please input your guess.");', "        let mut g = String::new();", "        io::stdin().read_line(&mut g).expect(\"read\");", '        if g.trim() == "7" { println!("You win"); break; }', '        println!("You guessed: {}", g.trim());', "    }", "}", ""].join("\n");
    try {
      h.conn.receive({ type: "debug-start", id: "g1", lang: "rust", code, path: "guess.rs", breakpoints: [] });
      await h.next((m) => m.type === "debug-out" && /Please input/.test((m as { text: string }).text));
      await new Promise((r) => setTimeout(r, 500));
      const printed = h.got.filter((m) => m.type === "debug-out").map((m) => (m as { text: string }).text).join("");
      assert.doesNotMatch(printed, /Please input[\s\S]*Please input/, "it waits instead of looping on end-of-file");
      h.conn.receive({ type: "input", id: "g1", text: "3\n" });
      await h.next((m) => m.type === "debug-out" && /You guessed: 3/.test((m as { text: string }).text));
      h.conn.receive({ type: "input", id: "g1", text: "7\n" });
      await h.next((m) => m.type === "debug-out" && /You win/.test((m as { text: string }).text));
      assert.equal(((await h.next((m) => m.type === "debug-exit")) as { code: number }).code, 0);
    } finally {
      h.close();
    }
  });

  it("a print loop comes in a few bundled messages, and Stop ends it within a second, with nothing after", async () => {
    const h = hubFor();
    const code = ["fn main() {", "    let mut n: u64 = 0;", "    loop {", '        println!("line {n}");', "        n += 1;", "    }", "}", ""].join("\n");
    try {
      h.conn.receive({ type: "debug-start", id: "f1", lang: "rust", code, path: "flood.rs", breakpoints: [] });
      await h.next((m) => m.type === "debug-start");
      await h.next((m) => m.type === "debug-out");
      await new Promise((r) => setTimeout(r, 1000));
      const messages = h.got.filter((m) => m.type === "debug-out").length;
      assert.ok(messages < 60, `about one message every 50 ms, not one per line (${messages} in a second)`);
      const t0 = Date.now();
      h.conn.receive({ type: "debug-stop", id: "f1" });
      const exit = (await h.next((m) => m.type === "debug-exit", 5000)) as { stopped: boolean };
      assert.ok(Date.now() - t0 < 1500, `stopped in ${Date.now() - t0} ms`);
      assert.equal(exit.stopped, true);
      const after = h.got.length;
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(h.got.slice(after).filter((m) => m.type === "debug-out").length, 0, "nothing comes after the stop");
    } finally {
      h.close();
    }
  });
});
