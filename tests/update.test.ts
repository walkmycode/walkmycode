// The desktop app's update modal (src/components/UpdateModal.tsx): what it reads from the release notes,
// and what Later and Skip this version do (src/lib/update.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { megabytes, releaseNotes } from "../src/lib/releaseNotes";
import { _resetUpdate, closeUpdate, openUpdate, skipUpdate, updateState } from "../src/lib/update";

// As release-please writes them (CHANGELOG.md, 0.1.3 and 0.1.4).
const NOTES = `## [0.1.4](https://github.com/example/app/compare/v0.1.3...v0.1.4) (2026-11-12)


### Features

* **learn:** talk with the professor, a live voice conversation in the lesson ([#53](https://github.com/example/app/issues/53)) ([5daa221](https://github.com/example/app/commit/5daa221dfb6d2380a8c88c185fa15a366ee18b49))
* **explore,learn:** code-only view, Explore mute ([#51](https://github.com/example/app/issues/51)) ([826bd04](https://github.com/example/app/commit/826bd04))
* a map of any codebase

### Bug Fixes

* **ide:** keep the [file tree](https://example.com) in step ([abc1234](https://github.com/example/app/commit/abc1234))

### Performance Improvements

* **voice:** first line plays at once

### Reverts

* **mcp:** undo the old sweep
`;

describe("the update's release notes", () => {
  it("become plain items: the kind from the heading, the area from the scope, no links or hashes", () => {
    assert.deepEqual(releaseNotes(NOTES), [
      { kind: "new", area: "Learn", text: "Talk with the professor, a live voice conversation in the lesson" },
      { kind: "new", area: "Explore, Learn", text: "Code-only view, Explore mute" },
      { kind: "new", area: "", text: "A map of any codebase" },
      { kind: "fixed", area: "IDE", text: "Keep the file tree in step" },
      { kind: "better", area: "Voice", text: "First line plays at once" },
      { kind: "changed", area: "MCP", text: "Undo the old sweep" },
    ]);
  });

  it("never point into the private repo", () => {
    assert.ok(releaseNotes(NOTES).every((n) => !/https?:|\(|#\d/.test(n.text)));
  });

  it("in no known shape are one plain item, and none are none", () => {
    assert.deepEqual(releaseNotes("WalkMyCode v0.1.2"), [{ kind: "changed", area: "", text: "WalkMyCode v0.1.2" }]);
    assert.deepEqual(releaseNotes(""), []);
    assert.deepEqual(releaseNotes(null), []);
  });

  it("sizes read in MB", () => {
    assert.equal(megabytes(96_412_345), "96.4 MB");
    assert.equal(megabytes(3_250_000), "3.25 MB");
  });
});

describe("Later and Skip this version", () => {
  const info = { version: "0.1.4", current: "0.1.3", date: "2026-11-12T10:00:00Z", notes: NOTES, size: 96_000_000 };
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };

  it("Later closes the modal and keeps the update for the title bar's chip; the chip opens it again", async () => {
    _resetUpdate({ info, open: true });
    closeUpdate();
    const s1 = await snapshot();
    assert.equal(s1.open, false);
    assert.equal(s1.info?.version, "0.1.4");
    openUpdate();
    assert.equal((await snapshot()).open, true);
  });

  it("there is no closing while it installs", async () => {
    _resetUpdate({ info, open: true, phase: "installing" });
    closeUpdate();
    assert.equal((await snapshot()).open, true);
  });

  it("Skip this version forgets it and remembers the version", async () => {
    _resetUpdate({ info, open: true });
    skipUpdate();
    const s = await snapshot();
    assert.equal(s.info, null);
    assert.equal(s.open, false);
    assert.equal(store.get("walkmycode:update-skip"), "0.1.4");
  });
});

async function snapshot() {
  return updateState();
}
