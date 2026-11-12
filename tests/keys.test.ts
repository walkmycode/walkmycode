// keys.env round trips: what gets written, what gets read back, what is
// refused, and that process.env is never touched. Runs in a temp WALKMYCODE_HOME.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { HttpError } from "../src/lib/providers/guard";
import { deleteKey, envStatus, keyFor, keysPath, keyStatus, readKeys, writeKey } from "../src/lib/providers/keys";

let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-keys-"));
  process.env.WALKMYCODE_HOME = home;
  for (const v of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "LOCAL_API_KEY"]) delete process.env[v];
});

beforeEach(() => {
  rmSync(keysPath(), { force: true });
});

after(() => {
  delete process.env.WALKMYCODE_HOME;
  delete process.env.GROQ_API_KEY;
  rmSync(home, { recursive: true, force: true });
});

function fileLines(): string[] {
  return existsSync(keysPath()) ? readFileSync(keysPath(), "utf8").split("\n").filter(Boolean) : [];
}

describe("writeKey", () => {
  it("writes one KEY=value line, reports has_key from settings, and leaves process.env alone", () => {
    writeKey("OPENAI_API_KEY", "sk-test-000");
    assert.deepEqual(fileLines(), ["OPENAI_API_KEY=sk-test-000"]);
    assert.deepEqual(envStatus("OPENAI_API_KEY"), { has_key: true, source: "settings" });
    assert.equal(keyStatus().openai.has_key, true);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  });

  it("trims the value", () => {
    writeKey("OPENAI_API_KEY", "  sk-test-000 \n");
    assert.deepEqual(fileLines(), ["OPENAI_API_KEY=sk-test-000"]);
  });

  it("replaces the line for the same var and keeps the others", () => {
    writeKey("OPENAI_API_KEY", "first");
    writeKey("GROQ_API_KEY", "gsk-test");
    writeKey("OPENAI_API_KEY", "second");
    assert.deepEqual(fileLines(), ["GROQ_API_KEY=gsk-test", "OPENAI_API_KEY=second"]);
    assert.equal(keyFor("openai")?.value, "second");
    assert.equal(keyFor("groq")?.value, "gsk-test");
  });

  it("refuses names outside the allowlist, verbatim", () => {
    for (const name of ["PATH", "WALKMYCODE_MODEL", "NODE_OPTIONS", "openai_api_key", ""]) {
      assert.throws(() => writeKey(name, "x"), (e: unknown) => e instanceof HttpError && e.status === 400 && e.message === `Unknown env var: ${name}`, name);
    }
    assert.equal(existsSync(keysPath()), false);
  });

  it("accepts the extra local and Deepgram vars", () => {
    writeKey("LOCAL_API_KEY", "lm-token");
    writeKey("DEEPGRAM_API_KEY", "dg-token");
    assert.equal(readKeys().get("LOCAL_API_KEY"), "lm-token");
    assert.equal(readKeys().get("DEEPGRAM_API_KEY"), "dg-token");
  });

  it("refuses a value longer than 1024 characters with the spec's message", () => {
    assert.throws(() => writeKey("OPENAI_API_KEY", "x".repeat(1025)), (e: unknown) => e instanceof HttpError && e.status === 400 && e.message === "That key is far longer than any real one.");
    writeKey("OPENAI_API_KEY", "x".repeat(1024));
    assert.equal(readKeys().get("OPENAI_API_KEY")?.length, 1024);
  });

  it("refuses control characters with the spec's message", () => {
    for (const bad of ["sk-te\nst", "sk-te\tst", "sk-test\x7f", "sk-\x00test"]) {
      assert.throws(() => writeKey("OPENAI_API_KEY", bad), (e: unknown) => e instanceof HttpError && e.message === "That key contains a line break or control character. Paste just the key.");
    }
    assert.equal(existsSync(keysPath()), false);
  });

  it("leaves no temp file behind", () => {
    writeKey("OPENAI_API_KEY", "sk-test-000");
    assert.equal(existsSync(keysPath() + ".tmp"), false);
  });
});

describe("deleteKey", () => {
  it("removes the line and keeps the rest; an empty value does the same", () => {
    writeKey("OPENAI_API_KEY", "a");
    writeKey("GROQ_API_KEY", "b");
    deleteKey("OPENAI_API_KEY");
    assert.deepEqual(fileLines(), ["GROQ_API_KEY=b"]);
    assert.deepEqual(envStatus("OPENAI_API_KEY"), { has_key: false, source: null });
    writeKey("GROQ_API_KEY", "   ");
    assert.deepEqual(fileLines(), []);
  });

  it("still refuses unknown names", () => {
    assert.throws(() => deleteKey("PATH"), /Unknown env var: PATH/);
  });

  it("removes a hand-edited line with `export` or spaces around the equals sign", () => {
    writeFileSync(keysPath(), ["export OPENAI_API_KEY=one", "XAI_API_KEY = two", "GROQ_API_KEY=three"].join("\n"));
    deleteKey("OPENAI_API_KEY");
    deleteKey("XAI_API_KEY");
    assert.deepEqual(fileLines(), ["GROQ_API_KEY=three"]);
    assert.equal(envStatus("XAI_API_KEY").has_key, false);
    writeKey("GROQ_API_KEY", "four");
    assert.deepEqual(fileLines(), ["GROQ_API_KEY=four"]);
  });
});

describe("keyFor", () => {
  it("prefers the file over process.env, then falls back to process.env", () => {
    process.env.GROQ_API_KEY = "from-env";
    assert.deepEqual(keyFor("groq"), { value: "from-env", source: "env" });
    assert.deepEqual(envStatus("GROQ_API_KEY"), { has_key: true, source: "env" });
    writeKey("GROQ_API_KEY", "from-file");
    assert.deepEqual(keyFor("groq"), { value: "from-file", source: "settings" });
    deleteKey("GROQ_API_KEY");
    assert.deepEqual(keyFor("groq"), { value: "from-env", source: "env" });
    assert.equal(process.env.GROQ_API_KEY, "from-env");
    delete process.env.GROQ_API_KEY;
    assert.equal(keyFor("groq"), null);
  });

  it("gives the keyless local provider a placeholder", () => {
    assert.deepEqual(keyFor("local"), { value: "local", source: "env" });
    assert.deepEqual(keyStatus().local, { has_key: true, source: null });
  });

  it("uses LOCAL_API_KEY as the local server's token when set, file first", () => {
    process.env.LOCAL_API_KEY = "lm-from-env";
    assert.deepEqual(keyFor("local"), { value: "lm-from-env", source: "env" });
    writeKey("LOCAL_API_KEY", "lm-from-file");
    assert.deepEqual(keyFor("local"), { value: "lm-from-file", source: "settings" });
    delete process.env.LOCAL_API_KEY;
  });
});

describe("readKeys", () => {
  it("strips quotes, skips comments and blank lines, tolerates `export`", () => {
    writeFileSync(keysPath(), ['# keys', '', 'OPENAI_API_KEY="quoted"', "export GROQ_API_KEY='single'", "XAI_API_KEY = spaced ", "NOEQUALS", "=novalue"].join("\n"));
    const keys = readKeys();
    assert.equal(keys.get("OPENAI_API_KEY"), "quoted");
    assert.equal(keys.get("GROQ_API_KEY"), "single");
    assert.equal(keys.get("XAI_API_KEY"), "spaced");
    assert.equal(keys.has("NOEQUALS"), false);
    assert.equal(keys.size, 3);
  });

  it("re-reads when the file's mtime changes and not otherwise", () => {
    writeFileSync(keysPath(), "OPENAI_API_KEY=one\n");
    utimesSync(keysPath(), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const first = readKeys();
    assert.equal(first.get("OPENAI_API_KEY"), "one");
    assert.equal(readKeys(), first);
    writeFileSync(keysPath(), "OPENAI_API_KEY=two\n");
    utimesSync(keysPath(), new Date(1_700_000_001_000), new Date(1_700_000_001_000));
    assert.equal(readKeys().get("OPENAI_API_KEY"), "two");
    rmSync(keysPath());
    assert.equal(readKeys().size, 0);
  });
});
