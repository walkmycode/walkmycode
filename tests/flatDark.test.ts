// The dark theme stays flat (docs/design/flat-dark.html, src/app/dark.css): one dark on every
// surface, no gradient, no shadow with blur. This reads the stylesheets themselves:
//   - the dark theme's surface tokens are all #141414;
//   - every rule, in any stylesheet, that paints a gradient, a blurred shadow, a text shadow or a
//     drop shadow has a dark answer: the same selector with :root[data-theme="dark"] in front,
//     setting that property to something flat (or hiding the element);
//   - an animation whose keyframes paint one is switched off, or swapped, in the dark theme;
//   - nothing in the dark theme's own rules paints one;
//   - no gradient is written in a component's code, where no stylesheet could answer it.
// So a gradient added tomorrow, anywhere, fails here until dark.css says what the dark theme shows
// in its place. What the browser really paints is checked by `npm run sweep:dark`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";

const SRC = join(process.cwd(), "src");
const DARK = ':root[data-theme="dark"]';
const walk = (dir: string, ext: RegExp, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
};
const rel = (p: string) => p.slice(process.cwd().length + 1).replace(/\\/g, "/");

const splitTop = (v: string, sep = ","): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of v) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
/** Does a shadow have a layer with blur? (The third length of a layer; an edge or a ring has none.) */
export function blurred(shadow: string): boolean {
  return splitTop(shadow).some((layer) => {
    const lengths = splitTop(layer.replace(/\binset\b/g, " ").replace(/(rgba?|hsla?|color-mix|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-fA-F]{3,8}\b/g, " "), " ").filter((t) => /^-?[\d.]/.test(t) || /^calc\(/.test(t));
    return lengths.length >= 3 && !/^-?0(\.0+)?[a-z%]*$/.test(lengths[2]);
  });
}
/** What a declaration paints that the flat dark theme does not have, or null. */
function paints(prop: string, value: string): "gradient" | "mask" | "shadow" | "text-shadow" | "filter" | null {
  const v = value.replace(/\s+/g, " ");
  if (/^(-webkit-)?mask(-image)?$/.test(prop)) return /gradient\(/.test(v) ? "mask" : null;
  if (/gradient\(/.test(v)) return "gradient";
  if (prop === "box-shadow" || (prop.startsWith("--") && /shadow|glow/.test(prop))) return v !== "none" && blurred(v) ? "shadow" : null;
  if (prop === "text-shadow") return v !== "none" ? "text-shadow" : null;
  if (prop === "filter" || prop === "backdrop-filter" || prop === "-webkit-backdrop-filter") return /drop-shadow\(|blur\(/.test(v) ? "filter" : null;
  return null;
}
/** The properties that can answer one: `background: none` answers a `background-image`, and so on. */
const answers = (prop: string, kind: string): string[] =>
  kind === "gradient" ? (prop.startsWith("--") ? [prop] : ["background", "background-image", "border-image", "border-image-source", prop]) : kind === "mask" ? ["mask", "mask-image", "-webkit-mask", "-webkit-mask-image", prop] : [prop];

interface Found {
  file: string;
  line: number;
  /** The @media / @container the rule sits in ("" at the top). */
  at: string;
  selector: string;
  prop: string;
  value: string;
  kind: string;
  keyframes?: string;
}

const sheets = walk(SRC, /\.css$/).map((p) => ({ file: rel(p), root: postcss.parse(readFileSync(p, "utf8")) }));
const context = (rule: Rule): { at: string; keyframes: string } => {
  let at = "";
  let keyframes = "";
  for (let p = rule.parent; p && p.type !== "root"; p = p.parent as typeof p) {
    if (p.type !== "atrule") continue;
    const a = p as AtRule;
    if (/keyframes$/.test(a.name)) keyframes = a.params;
    else if (a.name === "media" || a.name === "container" || a.name === "supports") at = `@${a.name} ${a.params.replace(/\s+/g, " ")}`;
  }
  return { at, keyframes };
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** A selector as the dark theme answers it: the theme in front, or on :root itself. */
const darkOf = (part: string) => (/^(:root|html)(?![\w-])/.test(part) ? part.replace(/^(:root|html)/, DARK) : `${DARK} ${part}`);

/** Every dark rule's declarations, by "context|selector part". A rule outside any @media answers inside one too. */
const dark = new Map<string, Map<string, string>>();
const all: Found[] = [];
const darkPaints: Found[] = [];
for (const { file, root } of sheets) {
  root.walkRules((rule) => {
    const { at, keyframes } = context(rule);
    const isDark = rule.selector.includes('data-theme="dark"');
    for (const d of rule.nodes.filter((n): n is Declaration => n.type === "decl")) {
      const kind = paints(d.prop, d.value);
      if (isDark && !keyframes) {
        for (const part of splitTop(norm(rule.selector))) {
          for (const ctx of [at, ""].slice(0, at ? 1 : 2)) {
            const key = `${ctx}|${part}`;
            dark.set(key, (dark.get(key) ?? new Map()).set(d.prop, d.value));
          }
        }
        if (kind) darkPaints.push({ file, line: d.source?.start?.line ?? 0, at, selector: norm(rule.selector), prop: d.prop, value: d.value, kind });
      } else if (kind) all.push({ file, line: d.source?.start?.line ?? 0, at, selector: norm(rule.selector), prop: d.prop, value: norm(d.value), kind, ...(keyframes ? { keyframes } : {}) });
    }
  });
}
/** The dark rule's declarations for a selector part, inside its context or outside any. */
const darkFor = (at: string, part: string): Map<string, string> => new Map([...(dark.get(`|${darkOf(part)}`) ?? []), ...(dark.get(`${at}|${darkOf(part)}`) ?? [])]);
const hides = (decls: Map<string, string>) => decls.get("display") === "none" || decls.get("content") === "none";

describe("the dark theme is one flat dark", () => {
  it("gives every surface token the same colour, #141414, and no glow", () => {
    const tokens = new Map<string, string>();
    for (const { root } of sheets) root.walkRules((r) => void (norm(r.selector) === DARK && r.walkDecls(/^--/, (d) => void tokens.set(d.prop, d.value.trim()))));
    const surfaces = ["--wall", "--wall-2", "--board", "--board-2", "--dg-card", "--frame", "--frame-2", "--ui", "--ui-2", "--ui-raise", "--out", "--bar", "--code-bg", "--code-gutter", "--ink"];
    assert.deepEqual(Object.fromEntries(surfaces.map((t) => [t, tokens.get(t)])), Object.fromEntries(surfaces.map((t) => [t, "#141414"])));
    assert.equal(tokens.get("--glow"), "none");
    assert.equal(tokens.get("--ui-line"), "#333333");
    assert.equal(tokens.get("--ui-text"), "#e6e6e4");
    assert.equal(tokens.get("--yellow"), undefined, "the accent is the same in both themes");
  });

  it("answers every gradient, blurred shadow, text shadow and drop shadow in every stylesheet", () => {
    const missing: string[] = [];
    for (const f of all.filter((x) => !x.keyframes)) {
      for (const part of splitTop(f.selector)) {
        const decls = darkFor(f.at, part);
        const answered = hides(decls) || answers(f.prop, f.kind).some((p) => decls.has(p) && !paints(p, decls.get(p)!));
        if (!answered) missing.push(`${f.file}:${f.line}  ${part} { ${f.prop}: ${f.value.slice(0, 70)} }  →  add to src/app/dark.css:  ${darkOf(part)} { ${answers(f.prop, f.kind)[0]}: … }`);
      }
    }
    assert.deepEqual(missing, [], `\n${missing.length} rule(s) paint a ${[...new Set(all.map((x) => x.kind))].join(" / ")} with no answer in the dark theme:\n${missing.join("\n")}\n`);
    assert.ok(all.length > 100, "the stylesheets were read");
  });

  it("switches off, in the dark theme, every animation whose keyframes paint one", () => {
    const painting = new Set(all.filter((x) => x.keyframes).map((x) => x.keyframes!));
    const missing: string[] = [];
    for (const { file, root } of sheets) {
      root.walkRules((rule) => {
        const { at, keyframes } = context(rule);
        if (keyframes || rule.selector.includes('data-theme="dark"')) return;
        for (const d of rule.nodes.filter((n): n is Declaration => n.type === "decl" && /^animation(-name)?$/.test(n.prop))) {
          for (const name of painting) {
            if (!new RegExp(`(^|[\\s,])${name}([\\s,]|$)`).test(d.value)) continue;
            for (const part of splitTop(norm(rule.selector))) {
              const decls = darkFor(at, part);
              const now = decls.get("animation-name") ?? decls.get("animation");
              if (hides(decls) || (now !== undefined && !new RegExp(`(^|[\\s,])${name}([\\s,]|$)`).test(now))) continue;
              missing.push(`${file}:${d.source?.start?.line}  ${part} runs @keyframes ${name}, which paints a glow  →  ${darkOf(part)} { animation-name: none; }`);
            }
          }
        }
      });
    }
    assert.deepEqual(missing, []);
    assert.ok(painting.has("ignite"), "the keyframes were read");
  });

  it("paints none of them in its own rules", () => {
    assert.deepEqual(darkPaints.map((f) => `${f.file}:${f.line} ${f.selector} { ${f.prop}: ${f.value} }`), []);
  });

  it("has no gradient written in a component, where no stylesheet could answer it", () => {
    const found: string[] = [];
    for (const p of walk(SRC, /\.tsx?$/)) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/(linear|radial|conic)-gradient\(|<(linear|radial)Gradient\b/.test(l)) found.push(`${rel(p)}:${i + 1} ${l.trim().slice(0, 90)}`);
        // A shadow in a component's own styles (the code editor's theme): only where dark.css is known to answer it.
        const shadow = /(?:boxShadow|textShadow)["']?\s*:\s*["'`]([^"'`]+)["'`]/.exec(l);
        if (shadow && blurred(shadow[1]) && !(rel(p) === "src/ide/Editor.tsx" && /\.cm-tooltip/.test(l))) found.push(`${rel(p)}:${i + 1} ${l.trim().slice(0, 90)}`);
      });
    }
    assert.deepEqual(found, []);
    assert.ok(!paints("box-shadow", darkFor("", ".cm-tooltip").get("box-shadow") ?? "0 12px 32px #000"), "the editor's list of suggestions has no shadow in the dark theme");
  });

  it("tells an edge from a shadow", () => {
    assert.equal(blurred("inset 2px 0 0 var(--yellow)"), false);
    assert.equal(blurred("0 0 0 1px rgba(243, 215, 122, .35)"), false);
    assert.equal(blurred("inset 0 -2px 0 var(--yellow), inset 0 0 0 1px var(--hair-2)"), false);
    assert.equal(blurred("0 12px 30px rgba(0,0,0,.45)"), true);
    assert.equal(blurred("0 0 0 4px rgba(243,215,122,.18), 0 0 14px 3px rgba(243,215,122,.4)"), true);
    assert.equal(blurred("inset 0 0 60px rgba(0,0,0,.45)"), true);
    assert.equal(blurred("0 2px calc(4px * var(--sp)) #000"), true);
  });
});
