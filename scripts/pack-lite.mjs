// npm run pack:lite [dest] — turns the Lite export (out/, from `npm run build:lite`)
// into the folder the Claude artifact publisher takes: <dest>/index.html (the page),
// the files beside it, and <dest>/files.json ([{ path, contentType? }]) listing them.
// Lecture Hall's proven recipe (lecture-hall/scripts-pack.mjs), adapted:
// - the page is a fragment: the publisher adds its own doctype, html, head and body;
// - "_next/" becomes "app/" (the artifact service reserves names that start with "_"),
//   with every path-like reference rewritten to match;
// - a literal U+FFFD, which the publisher refuses, is escaped in the bundles, where it
//   only appears inside string literals;
// - only what the page loads, in types the publisher serves: .js, .css, .woff2 (KaTeX
//   lists woff2 before woff and ttf, so browsers take it), .wasm, .mjs (as
//   text/javascript), .py (as text/plain) and the example app (examples/*.json). No archives, no source maps, no route
//   payloads (Lite never fetches another route) and no unreferenced "_" manifests.
// Chunks load from "./app/", next to the page. The bundler builds a Web Worker's URL
// from the site's root instead, which is not where Claude serves the artifact; the
// analyzer's worker is re-based in our own code (src/analyzer/assets.ts), and this
// script checks that the bundle still hands its worker the shape that code expects.
// Then it checks the publisher's limits: 255 files and 64 MB per publish, 16 MB per
// text file and 15 MB per binary file.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const out = "out";
const dest = process.argv[2] || "publish-lite";
const LIMITS = { files: 255, bytes: 64 * 1024 * 1024, text: 16 * 1024 * 1024, binary: 15 * 1024 * 1024 };

const fail = (why) => {
  console.error(`pack-lite: ${why}`);
  process.exit(1);
};

// Every path-like "_next/" (not identifiers such as "__next_f") becomes "app/".
const rewrite = (s) => s.replace(/(?<![\w])_next\//g, "app/");
const escapeFffd = (s) => s.replaceAll("�", "\\uFFFD");

/** Which exported files go up, and how the publisher should serve them. */
function pick(rel) {
  const name = rel.split("/").pop();
  if (name.startsWith("_")) return null;
  if (rel.startsWith("_next/static/")) {
    if (/\.(js|css)$/.test(rel)) return { text: true, bundle: true };
    if (/\.woff2$/.test(rel)) return { text: false };
    return null; // woff/ttf (woff2 is used), the raw worker source, the bundler's spare wasm, source maps
  }
  if (/^wasm\/[\w.-]+\.wasm$/.test(rel) || /^sql\/[\w.-]+\.wasm$/.test(rel)) return { text: false, contentType: "application/wasm" };
  if (/^py\/[\w.-]+\.wasm$/.test(rel)) return { text: false, contentType: "application/wasm" };
  if (/^py\/[\w.-]+\.mjs$/.test(rel)) return { text: true, contentType: "text/javascript" };
  if (/^py\/[\w.-]+\.py$/.test(rel)) return { text: true, contentType: "text/plain" };
  // The example app the home page offers ("Try with an example app"), one JSON file.
  if (/^examples\/[\w.-]+\.json$/.test(rel)) return { text: true, contentType: "application/json" };
  return null;
}

let html;
try {
  html = readFileSync(join(out, "index.html"), "utf8");
} catch {
  fail("no out/index.html: run `npm run build:lite` first.");
}
if (html.includes("�")) fail("index.html holds a literal U+FFFD, which the publisher refuses; find where it comes from.");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

const files = [];
let bytes = 0;
let largest = { path: "", size: 0 };
// The bundler's worker bootstrap: its URL from the site's root, its chunks in "#params=".
let workerShape = false;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const rel = relative(out, p).replaceAll("\\", "/");
    const how = pick(rel);
    if (!how) continue;
    const to = rel.replace(/^_next\//, "app/");
    mkdirSync(dirname(join(dest, to)), { recursive: true });
    let data = readFileSync(p);
    if (how.text) {
      let s = data.toString("utf8");
      if (how.bundle) {
        s = rewrite(s);
        if (s.includes("#params=") && s.includes("location.origin") && s.includes("SharedWorker")) workerShape = true;
      }
      data = Buffer.from(escapeFffd(s), "utf8");
    }
    writeFileSync(join(dest, to), data);
    const limit = how.text ? LIMITS.text : LIMITS.binary;
    if (data.length > limit) fail(`${to} is ${data.length} bytes, over the publisher's ${limit}-byte limit for one file.`);
    bytes += data.length;
    if (data.length > largest.size) largest = { path: to, size: data.length };
    files.push(how.contentType ? { path: to, contentType: how.contentType } : { path: to });
  }
};
walk(out);
// Not fatal: without the shape, mapping still works on the page's own thread, only slower.
if (!workerShape) console.warn("pack-lite: the bundle's worker bootstrap changed shape; check that the analyzer's worker still starts (src/analyzer/assets.ts).");

// The first thing the fragment paints, before its stylesheets and scripts arrive: the
// lantern's glow and "Opening WalkMyCode…", styled inline (the theme's own colours), so a
// slow first load inside Claude is never a blank frame. The page takes it away once it
// has mounted (src/lib/boot.ts); its id and class are that file's.
const BOOT =
  "<style>#wmc-boot{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:#23201c;color:#b8ae9c;" +
  'font:13.5px/1.4 "Segoe UI",system-ui,sans-serif;letter-spacing:.02em;text-align:center;transition:opacity .25s ease-out}' +
  "#wmc-boot i{display:inline-block;width:14px;height:14px;border-radius:50%;background:#f3d77a;" +
  "box-shadow:0 0 0 6px rgba(243,215,122,.14),0 0 28px 8px rgba(243,215,122,.35);animation:wmc-boot 1.6s ease-in-out infinite}" +
  "#wmc-boot p{margin:18px 0 0}#wmc-boot.gone{opacity:0;pointer-events:none}" +
  "@keyframes wmc-boot{50%{transform:scale(1.25);opacity:.75}}" +
  ":root[data-motion=off] #wmc-boot i{animation:none}@media (prefers-reduced-motion:reduce){:root:not([data-motion=on]) #wmc-boot i{animation:none}}</style>" +
  '<div id="wmc-boot" role="status" aria-live="polite"><div><i aria-hidden="true"></i><p>Opening WalkMyCode…</p></div></div>';

const page =
  BOOT +
  rewrite(html)
    .replace(/<!DOCTYPE html>/i, "")
    .replace(/<html[^>]*>/i, "")
    .replace(/<\/html>/i, "")
    .replace(/<head[^>]*>/i, "")
    .replace(/<\/head>/i, "")
    .replace(/<body[^>]*>/i, "")
    .replace(/<\/body>/i, "")
    .replace(/<link rel="icon"[^>]*>/gi, "");
writeFileSync(join(dest, "index.html"), page);

// Everything the page itself names must be in the folder.
const have = new Set(files.map((f) => f.path));
const missing = [...page.matchAll(/(?:src|href)="\.\/(app\/[^"]+)"/g)].map((m) => m[1]).filter((p) => !have.has(p));
if (missing.length) fail(`the page names files that are not packed: ${missing.join(", ")}`);
if (files.some((f) => /\.(zip|gz|br|tar|7z|rar)$/i.test(f.path))) fail("an archive slipped in; the publisher refuses them.");

files.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(dest, "files.json"), JSON.stringify(files, null, 1));

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const total = bytes + Buffer.byteLength(page);
console.log(`pack-lite: ${dest}/index.html (${page.length} bytes) + ${files.length} files = ${files.length + 1} files, ${mb(total)}`);
console.log(`  limits per publish: ${LIMITS.files} files, ${mb(LIMITS.bytes)}; largest file ${largest.path} (${mb(largest.size)})`);
if (files.length + 1 > LIMITS.files) console.log(`  OVER the file limit: publish in ${Math.ceil((files.length + 1) / LIMITS.files)} parts to the same artifact (each later publish adds files).`);
if (total > LIMITS.bytes) fail(`${mb(total)} is over the ${mb(LIMITS.bytes)} limit for one publish.`);
