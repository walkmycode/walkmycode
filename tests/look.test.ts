// Text & icon size and density (src/lib/look.ts): the steps, the CSS variables in globals.css, and a
// guard that every stylesheet's text and spacing follow them (new CSS written in plain px would not
// shrink or grow with the setting).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { controlScale, DEFAULT_DENSITY, DEFAULT_TEXT, DEFAULT_THEME, DENSITIES, lookCss, LOOK_BOOT, parseDensity, parseText, parseTheme, SPACE_SCALE, TEXT_SCALE, TEXT_STEPS } from "../src/lib/look";

const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []));

describe("look: the steps", () => {
  it("starts at the smallest text and compact spacing", () => {
    assert.equal(DEFAULT_TEXT, TEXT_STEPS[0]);
    assert.equal(DEFAULT_DENSITY, "compact");
    assert.ok(Math.min(...Object.values(TEXT_SCALE)) === TEXT_SCALE[DEFAULT_TEXT]);
    assert.ok(Math.min(...Object.values(SPACE_SCALE)) === SPACE_SCALE[DEFAULT_DENSITY]);
  });

  it("keeps the original size reachable: medium text and roomy spacing scale by exactly 1", () => {
    assert.equal(TEXT_SCALE[3], 1);
    assert.equal(SPACE_SCALE.roomy, 1);
    assert.equal(controlScale(3, "roomy"), 1);
  });

  it("grows step by step, and never shrinks a control below 0.7", () => {
    for (let i = 1; i < TEXT_STEPS.length; i++) assert.ok(TEXT_SCALE[TEXT_STEPS[i]] > TEXT_SCALE[TEXT_STEPS[i - 1]]);
    for (const t of TEXT_STEPS) for (const d of DENSITIES) assert.ok(controlScale(t, d) >= 0.7);
  });

  it("reads saved values, and anything unknown as the default", () => {
    assert.equal(parseText("4"), 4);
    assert.equal(parseText("9"), DEFAULT_TEXT);
    assert.equal(parseText(null), DEFAULT_TEXT);
    assert.equal(parseDensity("roomy"), "roomy");
    assert.equal(parseDensity("huge"), DEFAULT_DENSITY);
  });

  it("sets every attribute before the first paint, defaults included", () => {
    assert.match(LOOK_BOOT, /dataset\.text=.*\|\|"1"/);
    assert.match(LOOK_BOOT, /dataset\.density=.*\|\|"compact"/);
    assert.match(LOOK_BOOT, /dataset\.theme=.*\|\|"dark"/);
  });

  it("starts dark, keeps the warm theme on offer, and reads anything else as dark", () => {
    assert.equal(DEFAULT_THEME, "dark");
    assert.equal(parseTheme("warm"), "warm");
    assert.equal(parseTheme("neon"), "dark");
    assert.equal(parseTheme(null), "dark");
  });

  it("the dark theme sets every colour the warm one sets on :root's surfaces", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const block = css.slice(css.indexOf(':root[data-theme="dark"] {'));
    for (const v of ["--wall", "--board", "--frame", "--ui", "--ui-2", "--ui-line", "--ui-text", "--ui-dim", "--out", "--hair", "--bar", "--code-bg", "--code-gutter"]) assert.match(block.slice(0, block.indexOf("}")), new RegExp(`${v}:`), v);
  });
});

describe("look: the stylesheets", () => {
  it("globals.css carries lookCss() as generated", () => {
    assert.ok(readFileSync("src/app/globals.css", "utf8").replace(/\r\n/g, "\n").includes(lookCss()), "regenerate the block in globals.css from lookCss()");
  });

  it("uses one text size everywhere: var(--text), bold where text matters (the owner's rule)", () => {
    // The map's cards keep their own sizes (the map zooms, mapLayout places them);
    // "look: fixed" marks the size slider's sample letters.
    const exempt = /div\.node|\.lanehead|\.svc\b|\.react-flow|\.sedge|\.node\.portal/;
    const bad: string[] = [];
    for (const f of cssFiles("src")) {
      for (const m of readFileSync(f, "utf8").matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (exempt.test(m[1]) || m[2].includes("look: fixed")) continue;
        for (const decl of m[2].split(";")) {
          const d = /^\s*(font-size|font)\s*:\s*([\s\S]*)$/.exec(decl);
          if (!d) continue;
          // the size: the whole font-size, or a font shorthand's size before any "/line-height"
          const size = d[1] === "font-size" ? d[2] : d[2].split("/")[0];
          if (/\d(px|rem)\b|var\(--fs\)/.test(size) && !size.includes("var(--text)")) bad.push(`${f}: ${m[1].trim().slice(0, 60)} { ${decl.trim().slice(0, 80)} }`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  it("writes text and spacing through --fs and --sp, not plain px", () => {
    const plain = /(?<![-\w$])(font|font-size|line-height|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:[^;{}]*?(?<![\w.#-])(?!0px)\d*\.?\d+px(?![^;{}]*var\(--(fs|sp)\))/;
    const bad: string[] = [];
    for (const f of cssFiles("src")) {
      readFileSync(f, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (line.includes("look: fixed")) return;
          // A one-line @media rule: its prelude (the breakpoint) is plain px by design, its declarations are not.
          const body = /^\s*@(media|container|supports)/.test(line) ? line.slice(line.indexOf("{") + 1) : line;
          for (const decl of body.split(/[;{}]/)) if (plain.test(decl)) bad.push(`${f}:${i + 1} ${decl.trim()}`);
        });
    }
    assert.deepEqual(bad, [], "use calc(Npx * var(--fs)) for text and calc(Npx * var(--sp)) for spacing");
  });
});
