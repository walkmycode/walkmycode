// A diagram drawn again (the board comes back into view) reads its lanes from what was kept on it
// (src/lib/diagramStyle.ts, styleSvg). Found in Chrome on a lesson's class diagram: a diagram with no lanes is kept
// as " ", read back as a lane called " ", and the legend crashed looking up its colour.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { styleSvg } from "../src/lib/diagramStyle";

const dressed = (v: string) => ({ dataset: { dressed: v } }) as unknown as SVGSVGElement;

describe("a diagram drawn again", () => {
  it("reads back no lanes from a diagram that had none, not a lane called \" \"", () => {
    assert.deepEqual(styleSvg(dressed(" ")), []);
  });

  it("reads back the lanes it had, and drops any name the legend has no colour for", () => {
    assert.deepEqual(styleSvg(dressed("ui,api,external")), ["ui", "api", "external"]);
    assert.deepEqual(styleSvg(dressed("ui, nonsense ,data")), ["ui", "data"]);
  });
});
