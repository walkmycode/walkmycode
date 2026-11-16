// A group that floats out of the dock and back goes home: the neighbour and side that describe its
// slot (src/shell/home.ts), kept across reloads.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeFrom, homeOf, opposite, saveHome, type Box } from "../src/shell/home";

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

// Map | Code | Guide, 8px sashes, as the Explore preset lays them out.
const map = { id: "map", box: box(35, 38, 676, 976) };
const code = { id: "code", box: box(719, 38, 552, 976) };
const guide = { id: "guide", box: box(1279, 38, 395, 976) };

describe("dock: where a group lives", () => {
  it("is beside a neighbour sharing a whole edge, across the sash", () => {
    const home = homeFrom("code", code.box, [map, guide]);
    assert.ok(home);
    assert.ok(home.beside === "map" ? home.side === "right" : home.beside === "guide" && home.side === "left");
    assert.deepEqual(homeFrom("guide", guide.box, [map, code]), { beside: "code", side: "right", width: 395, height: 976 });
    assert.deepEqual(homeFrom("map", map.box, [code, guide]), { beside: "code", side: "left", width: 676, height: 976 });
  });

  it("prefers the sibling in its own split over a longer edge", () => {
    // Map on the left, full height; Code over Guide on the right.
    const left = { id: "map", box: box(0, 0, 600, 1000) };
    const top = { id: "code", box: box(608, 0, 600, 600) };
    const bottom = { id: "guide", box: box(608, 608, 600, 392) };
    // Code touches Map (600px of edge) and Guide (600px); Guide is its sibling (same width), Map is not.
    assert.deepEqual(homeFrom("code", top.box, [left, bottom]), { beside: "guide", side: "top", width: 600, height: 600 });
    assert.deepEqual(homeFrom("guide", bottom.box, [left, top]), { beside: "code", side: "bottom", width: 600, height: 392 });
  });

  it("has none when nothing touches it", () => {
    assert.equal(homeFrom("code", code.box, [{ id: "far", box: box(3000, 3000, 10, 10) }]), null);
    assert.equal(homeFrom("code", code.box, []), null);
  });

  it("swaps to the opposite side", () => {
    assert.equal(opposite.left, "right");
    assert.equal(opposite.top, "bottom");
  });
});

describe("dock: homes are kept", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
  };

  it("survive a reload, and are forgotten once used", () => {
    const s = store();
    saveHome("g7", { beside: "g1", side: "right", width: 552, height: 976, sizes: { g1: { width: 676, height: 976 } } }, s);
    assert.ok(s.raw.get("walkmycode.dock.homes")?.includes("g7"));
    assert.equal(homeOf("g7", s)?.beside, "g1");
    saveHome("g7", null, s);
    assert.equal(homeOf("g7", s), null);
  });

  it("read nothing from a broken store", () => {
    const s = { getItem: () => "{not json", setItem: () => {} };
    assert.equal(homeOf("nope", s), null);
  });
});
