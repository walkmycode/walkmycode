// Every drawing in src/lib/drawings, on one page, to look at: grouped by the file it is in, at the size a
// scene draws it and smaller, glad and sad for a person, on dark and on light. Writes
// docs/design/drawings-gallery.html. Run from the repo root: npx tsx scripts/drawings-gallery.ts [--only=systems,code]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DrawingSet } from "../src/lib/drawings/types";
import { LOOKS } from "../src/lib/drawings";

const dir = join(process.cwd(), "src/lib/drawings/set");
const css = readFileSync(join(process.cwd(), "src/lib/drawings/drawings.css"), "utf8");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

async function main() {
const sets: { file: string; set: DrawingSet }[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "parts.ts").sort()) {
  if (only && !only.includes(f.replace(/\.ts$/, ""))) continue;
  const mod = (await import(pathToFileURL(join(dir, f)).href)) as Record<string, unknown>;
  for (const v of Object.values(mod)) if (v && typeof v === "object" && !Array.isArray(v)) sets.push({ file: f, set: v as DrawingSet });
}

const svg = (name: string, d: DrawingSet[string], k: number, state = "") => {
  const look = d.person ? LOOKS[k % LOOKS.length] : null;
  const vars = look ? `--t:${look.tint};--sk:${look.skin};--hr:${look.hair}` : `--t:${d.tint}${d.hair ? `;--hr:${d.hair}` : ""}`;
  return `<svg class="art${look?.v ? ` v-${look.v}` : ""}${state ? ` ${state}` : ""}" viewBox="0 0 64 64" style="${vars}" aria-label="${name}">${d.svg}</svg>`;
};

let total = 0;
let count = 0;
const sections = sets.map(({ file, set }) => {
  const cards = Object.entries(set).map(([name, d], k) => {
    total += d.svg.length;
    count++;
    const big = d.svg.length > 1500 ? " over" : "";
    return `<div class="card" id="${name}">${svg(name, d, k)}<div class="small">${svg(name, d, k)}${d.person ? svg(name, d, k, "sad") : ""}</div>` +
      `<b>${name}</b><span class="also">${esc(d.also.join(" · "))}</span><span class="kb${big}">${d.svg.length} B</span></div>`;
  });
  return `<section><h2>${file.replace(/\.ts$/, "")} <span>${cards.length}</span></h2><div class="grid">${cards.join("")}</div></section>`;
});

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Learn: every drawing (gallery)</title>
<style>
${css}
:root { --bg:#1e1f22; --ui:#2b2d30; --line:#43454a; --text:#dfe1e5; --dim:#9da0a8; --faint:#6f737a; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:13px/1.45 Inter, system-ui, sans-serif; padding:20px clamp(16px, 2vw, 32px); }
header { display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; margin-bottom:14px; } h1 { margin:0; font-size:20px; } header p { margin:0; color:var(--dim); }
label { color:var(--dim); } section { margin:18px 0 26px; }
h2 { margin:0 0 8px; font-size:15px; text-transform:capitalize; } h2 span { color:var(--faint); font-weight:500; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); border-top:1px solid var(--line); border-left:1px solid var(--line); }
.card { background:var(--ui); border-right:1px solid var(--line); border-bottom:1px solid var(--line); padding:14px 10px 10px; display:flex; flex-direction:column; align-items:center; gap:5px; text-align:center; }
.card > svg.art { width:96px; height:96px; }
.small { display:flex; gap:8px; align-items:flex-end; } .small svg.art { width:32px; height:32px; }
.card b { font-weight:650; } .also { color:var(--dim); font-size:11.5px; } .kb { color:var(--faint); font:11px Consolas, monospace; } .kb.over { color:#ee8f86; }
body.light { --bg:#f1ece2; --ui:#fbf8f2; --line:#ddd5c6; --text:#2f2a22; --dim:#6b6252; --faint:#958b78; }
</style></head><body>
<header><h1>Every drawing</h1><p>${count} drawings · ${Math.round(total / 1024)} KB of shapes · ${Math.round(total / Math.max(count, 1))} B each on average</p>
<label><input type="checkbox" onchange="document.body.classList.toggle('light', this.checked)"> light page</label></header>
${sections.join("\n")}
</body></html>`;

const out = only ? `docs/design/drawings-gallery-${only.join("-")}.html` : "docs/design/drawings-gallery.html";
writeFileSync(join(process.cwd(), out), html);
console.log(`${count} drawings, ${total} bytes -> ${out}`);
}
void main();
