// The rename from Lantern to WalkMyCode: files, settings and browser
// preferences saved under the old names keep working, and nothing old is
// moved or deleted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dataDirIn, envVar } from "../src/lib/dataDir";
import { oldPrefKey, readPref, removePref } from "../src/lib/prefs";
import { keyFor, keysPath, writeKey } from "../src/lib/providers/keys";

describe("the data folder", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "walkmycode-rename-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("is .walkmycode when neither folder exists", () => {
    assert.equal(dataDirIn(base), join(base, ".walkmycode"));
  });

  it("is the old .lantern when only that one exists", () => {
    mkdirSync(join(base, ".lantern"));
    assert.equal(dataDirIn(base), join(base, ".lantern"));
  });

  it("is .walkmycode once it exists, even next to an old .lantern", () => {
    mkdirSync(join(base, ".lantern"));
    mkdirSync(join(base, ".walkmycode"));
    assert.equal(dataDirIn(base), join(base, ".walkmycode"));
  });

  it("keeps reading and writing keys in an old .lantern folder in place", () => {
    const before = process.env.WALKMYCODE_HOME;
    process.env.WALKMYCODE_HOME = base;
    try {
      mkdirSync(join(base, ".lantern"));
      writeFileSync(join(base, ".lantern", "keys.env"), "GROQ_API_KEY=gsk_oldfolder_key_123456\n");
      assert.equal(keysPath(), join(base, ".lantern", "keys.env"));
      assert.equal(keyFor("groq")?.value, "gsk_oldfolder_key_123456");
      writeKey("OPENAI_API_KEY", "sk-proj-newkey_abcdef123456");
      assert.match(readFileSync(join(base, ".lantern", "keys.env"), "utf8"), /^OPENAI_API_KEY=/m);
      assert.equal(existsSync(join(base, ".walkmycode")), false, "the old folder is never moved");
    } finally {
      if (before === undefined) delete process.env.WALKMYCODE_HOME;
      else process.env.WALKMYCODE_HOME = before;
    }
  });
});

describe("settings from the environment", () => {
  it("prefer WALKMYCODE_*, then the old LANTERN_*", () => {
    assert.equal(envVar("MODEL", { WALKMYCODE_MODEL: "a", LANTERN_MODEL: "b" }), "a");
    assert.equal(envVar("MODEL", { LANTERN_MODEL: "b" }), "b");
    assert.equal(envVar("MODEL", { WALKMYCODE_MODEL: "", LANTERN_MODEL: "b" }), "", "a set but blank new name still wins");
    assert.equal(envVar("MODEL", {}), undefined);
  });
});

describe("browser preferences", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it("map each new key to its old name", () => {
    assert.equal(oldPrefKey("walkmycode.motion"), "lantern.motion");
    assert.equal(oldPrefKey("walkmycode:voice"), "lantern:voice");
    assert.equal(oldPrefKey("lecture-hall:voice"), "lecture-hall:voice");
  });

  it("read the old key when the new one is missing, and the new one first", () => {
    const s = store();
    s.m.set("lantern.layout", "old");
    assert.equal(readPref(s, "walkmycode.layout"), "old");
    s.m.set("walkmycode.layout", "new");
    assert.equal(readPref(s, "walkmycode.layout"), "new");
  });

  it("clear both names, so a cleared choice does not come back", () => {
    const s = store();
    s.m.set("lantern.motion", "off");
    s.m.set("walkmycode.motion", "on");
    removePref(s, "walkmycode.motion");
    assert.equal(readPref(s, "walkmycode.motion"), null);
  });
});
