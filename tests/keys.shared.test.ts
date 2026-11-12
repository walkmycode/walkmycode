// A key another WalkMyCode on this computer saved (the full app's keys.env, say)
// is offered, not asked for again: the list of key files, the "found" standing,
// the copy, and that nothing outside a .walkmycode/.lantern keys.env is read.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { copyFoundKey, envStatus, keyFilesListPath, keysPath, readKeys } from "../src/lib/providers/keys";

let home: string;
let other: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-shared-"));
  process.env.WALKMYCODE_HOME = home;
  delete process.env.GROQ_API_KEY;
  mkdirSync(join(home, ".walkmycode"), { recursive: true });
  other = join(home, "my-app", ".lantern");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "keys.env"), "GROQ_API_KEY=gsk_from_the_full_app\n");
});

beforeEach(() => {
  rmSync(keysPath(), { force: true });
  writeFileSync(keyFilesListPath(), JSON.stringify([join(other, "keys.env")]));
});

after(() => {
  delete process.env.WALKMYCODE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("keys another WalkMyCode saved", () => {
  it("names the folder that has the key, without its value", () => {
    const s = envStatus("GROQ_API_KEY");
    assert.deepEqual(s, { has_key: false, source: null, found: "my-app" });
    assert.ok(!JSON.stringify(s).includes("gsk_"));
  });

  it("copies it into this keys.env on request", () => {
    assert.equal(copyFoundKey("GROQ_API_KEY"), true);
    assert.equal(readKeys().get("GROQ_API_KEY"), "gsk_from_the_full_app");
    assert.deepEqual(envStatus("GROQ_API_KEY"), { has_key: true, source: "settings" });
  });

  it("offers nothing for a key no one saved", () => {
    assert.deepEqual(envStatus("DEEPGRAM_API_KEY"), { has_key: false, source: null });
    assert.equal(copyFoundKey("DEEPGRAM_API_KEY"), false);
  });

  it("reads only keys.env files inside a .walkmycode or .lantern folder, and only allowlisted names", () => {
    const stray = join(home, "secrets.txt");
    writeFileSync(stray, "GROQ_API_KEY=gsk_stray\nPATH=/evil\n");
    writeFileSync(keyFilesListPath(), JSON.stringify([stray]));
    assert.equal(envStatus("GROQ_API_KEY").found, undefined);
    assert.equal(copyFoundKey("PATH"), false);
  });

  it("lists this keys.env once when it is read, so the other WalkMyCode can find it", () => {
    writeFileSync(keysPath(), "DEEPGRAM_API_KEY=dg-token\n");
    readKeys();
    readKeys();
    const list = JSON.parse(readFileSync(keyFilesListPath(), "utf8")) as string[];
    assert.equal(list.filter((p) => p.endsWith(join(".walkmycode", "keys.env"))).length, 1);
  });
});
