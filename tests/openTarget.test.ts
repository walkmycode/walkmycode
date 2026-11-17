// Where a file the user opens goes (src/shell/openTarget.ts): the group they chose (its tab bar, or a
// code tab, pressed), never on top of the panel they opened it from, never over the Guide, never into
// a pop-out window. Using a panel (a card on the map, the file tree) chooses nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOURCE_MS, emptyLog, isCodePanel, pickTarget, pressed, type FocusLog, type GroupView } from "../src/shell/openTarget";

// The Explore layout: Map | Code | Guide (with Details and Files as tabs).
const groups = (guideShows = "files"): GroupView[] => [
  { id: "g-map", location: "grid", active: "map" },
  { id: "g-code", location: "grid", active: "code:home" },
  { id: "g-guide", location: "grid", active: guideShows },
];
const choose = (log: FocusLog, group: string, t: number) => pressed(log, { group, t, kind: "choose" });
const use = (log: FocusLog, group: string, t: number) => pressed(log, { group, t, kind: "use" });

describe("where a file the user opens goes", () => {
  it("goes to the default place when the user has chosen nowhere", () => {
    assert.equal(pickTarget(emptyLog(), groups(), 0), null);
  });

  it("goes to the Map's group when the user chose it (its tab bar) and picks a file in Files", () => {
    let log = choose(emptyLog(), "g-map", 0);
    log = choose(log, "g-guide", 5000); // the Files tab, on the guide's tab bar
    log = use(log, "g-guide", 6000); // the file's row
    assert.equal(pickTarget(log, groups("files"), 6050), "g-map");
  });

  it("never sends files over the map because a card was clicked: exploring the map chooses nothing", () => {
    let log = choose(emptyLog(), "g-code", 0);
    log = use(log, "g-map", 4000); // a card on the map
    log = use(log, "g-guide", 9000); // "Walk it", a citation
    assert.equal(pickTarget(log, groups("guide"), 9100), "g-code");
    assert.equal(pickTarget(use(emptyLog(), "g-map", 0), groups(), 100), null, "nothing chosen: the default place");
  });

  it("never opens on top of the card or citation it was opened from", () => {
    let log = choose(emptyLog(), "g-code", 0);
    log = choose(log, "g-map", 3000); // the Map's tab
    log = use(log, "g-map", 4000); // then a card on it
    assert.equal(pickTarget(log, groups(), 4100), "g-code");
  });

  it("opens beside a code tab when it was opened from inside one (following an import)", () => {
    let log = choose(emptyLog(), "g-map", 0);
    log = choose(log, "g-code", 4000); // a press in a code tab chooses its group
    assert.equal(pickTarget(log, groups(), 4100), "g-code");
  });

  it("never covers the Guide", () => {
    let log = choose(emptyLog(), "g-code", 0);
    log = choose(log, "g-guide", 3000);
    assert.equal(pickTarget(log, groups("guide"), 9000), "g-code", "an answer's file opens in Code, not over the answer");
    assert.equal(pickTarget(choose(emptyLog(), "g-guide", 0), groups("guide"), 9000), null, "nothing else chosen: the default place");
  });

  it("opens in the Guide's group when it shows Files or Details and the user chose it", () => {
    let log = choose(emptyLog(), "g-guide", 0);
    log = use(log, "g-map", 1000);
    assert.equal(pickTarget(log, groups("details"), 1000 + SOURCE_MS + 1), "g-guide");
  });

  it("skips a group that has gone and a pop-out window", () => {
    let log = choose(emptyLog(), "g-code", 0);
    log = choose(log, "g-gone", 100);
    log = choose(log, "g-pop", 200);
    const gs: GroupView[] = [...groups(), { id: "g-pop", location: "popout", active: "map" }];
    assert.equal(pickTarget(log, gs, 9000), "g-code");
  });

  it("keeps each chosen group once, the latest first; a press that only uses a panel moves nothing", () => {
    let log = choose(emptyLog(), "a", 0);
    log = choose(log, "b", 1);
    log = choose(log, "a", 2);
    log = use(log, "c", 3);
    assert.deepEqual(log.order, ["a", "b"]);
    assert.equal(log.press?.group, "c");
  });

  it("knows a code tab", () => {
    assert.equal(isCodePanel("code:home"), true);
    assert.equal(isCodePanel("code:src/app.ts"), true);
    assert.equal(isCodePanel("map"), false);
    assert.equal(isCodePanel(undefined), false);
  });
});
