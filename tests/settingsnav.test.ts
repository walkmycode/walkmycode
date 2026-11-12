// Settings' panes and the ways to them (src/lib/settingsNav.ts): the menu's
// panes, who answers by build, the home page's #settings/<pane> hash, and
// "Open settings" naming the pane it is about.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answersFor, hashFor, isPane, PANES, paneFromHash, paneOf, panesFor, takeWanted, openSettings } from "../src/lib/settingsNav";

describe("Settings panes", () => {
  it("lists the panes of the mockup, in its order, with This computer after Privacy (not in Lite)", () => {
    assert.deepEqual(
      PANES.map((p) => p.label),
      ["AI model", "Voice", "Privacy", "This computer", "Motion & look", "About"],
    );
    assert.deepEqual(
      panesFor("lite").map((p) => p.id),
      ["ai", "voice", "privacy", "motion", "about"],
    );
    assert.equal(panesFor("full"), PANES);
    assert.equal(panesFor("mcp"), PANES);
    assert.equal(isPane("voice"), true);
    assert.equal(isPane("keys"), false);
  });

  it("lets the viewer's Claude answer in Lite and in WalkMyCode for Claude, the app's providers elsewhere", () => {
    assert.equal(answersFor("full"), "providers");
    assert.equal(answersFor("lite"), "claude");
    assert.equal(answersFor("mcp"), "claude");
  });

  it("reads and writes the pane in the URL hash", () => {
    assert.equal(paneFromHash("#settings/voice"), "voice");
    assert.equal(paneFromHash("#settings"), "ai");
    assert.equal(paneFromHash("#settings/nonsense"), "ai");
    assert.equal(paneFromHash("#system"), null, "the map's own hashes are not Settings'");
    assert.equal(paneFromHash(""), null);
    assert.equal(hashFor("privacy"), "#settings/privacy");
    for (const p of PANES) assert.equal(paneFromHash(hashFor(p.id)), p.id);
  });

  it("knows the pane an Open settings event is about, and keeps it for a view that opens later", () => {
    assert.equal(paneOf(new CustomEvent("open-settings", { detail: { pane: "voice" } })), "voice");
    assert.equal(paneOf(new CustomEvent("open-settings")), null);
    assert.equal(paneOf(new CustomEvent("open-settings", { detail: { pane: "elsewhere" } })), null);
    openSettings("privacy");
    assert.equal(takeWanted(), "privacy");
    assert.equal(takeWanted(), null, "taken once");
  });
});
