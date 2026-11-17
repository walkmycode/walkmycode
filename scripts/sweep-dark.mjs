// npm run sweep:dark: the dark theme is one flat dark (docs/design/flat-dark.html, src/app/dark.css).
// Opens the app's main views in the dark theme (its own dev server on its own port, a throwaway
// WALKMYCODE_HOME, the bundled example project and the lesson Learn comes with) and reads what the
// browser really paints, on every element and its ::before and ::after:
//   - no background-image or mask with a gradient;
//   - every background colour that is not see-through is the one dark, rgb(20, 20, 20), unless the
//     element is in ALLOW below (marks that carry meaning, the editor's selection, pictures);
//   - no shadow with blur, no text shadow, no drop-shadow or blur filter.
// A screenshot of each view is saved (SHOTS=<folder>, default docs/design/shots/flat-dark).
// Exit code 1 when anything was found. tests/flatDark.test.ts checks the stylesheets themselves;
// this checks what they add up to, inline styles and other people's CSS included.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SWEEP_PORT ?? 3127);
// SWEEP_URL=http://localhost:3000 looks at an app that is already running, and starts none.
const BASE = process.env.SWEEP_URL ?? `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS ?? join(root, "docs", "design", "shots", "flat-dark");
const DARK = [20, 20, 20];

/** What may keep a colour of its own in the dark theme, and why. Anything else that is not #141414 is a finding. */
export const ALLOW = [
  // Marks that carry meaning: status dots and lights, step and progress marks, count badges, lane and kind marks.
  [".brand-dot, .brand-full::after, .ai-led, .setv-dot, .dot, .talk-dot, .talk-rec i, .fly-dot, .trace-dot, .lantern-light, .map-wait .glow, .update-chip i, .dstate i, .setup-light, .setup-status .pulse, .lh-saved .dot, .learn .thinking i", "a status dot or light"],
  [".progress button, .progressbar .fill, .progressbar .fill i, .progressbar .pdot, .sv-bar, .sv-bar i, .update-bar i, .lh-bar, .lh-bar i, .lh-steps i, .lh-stats, .learn .chalk-progress span, .learn .road-progress span, .learn .outline .meter .bar, .learn .outline .meter .bar span, .learn .recall .boxes i, .segs i.on, .segs i.hit, .step-mark i, .sp-dots button, .wscene .dots button, .tree .step", "a progress or step mark"],
  [".nbadge, .git-n, .setup-pill-n, .learn .prof-tabs .count.due, .update-kind, .mcard-blk, .su-radio::after", "a count badge or a kind mark"],
  [".node.selected::before, .svc.selected::before, .tree-hit.sel::before, .tree .file.beacon::after, .connect h1 .i, .guide .frame.thinking::before, .guide .board .scribing::after, .learn .bc-bar::before", "a beacon: the small yellow mark beside what is selected or being written"],
  // Lines drawn as 1–2px boxes: they are borders.
  [".mdp hr, .ide-split::before, .learn .prof-resize::before, .learn .msg .pause::before, .learn .msg .pause::after, .setup-feed::before, .dv-sash, .dv-tab-divider, .sp-stage .dn.s-diamond::before, .sp-stage .dn.s-start, .sp-stage .dn.s-end, .sp-stage .tl .now, .sp-stage .runner.dot", "a line or a small shape of a drawing"],
  // The code editor: what is selected, the matching bracket, a breakpoint.
  [".cm-selectionBackground, .cm-selectionMatch, .cm-matchingBracket, .cm-searchMatch, .cm-bp, .cm-cursor, .xterm *", "the editor's and terminal's own selection, cursor and breakpoint"],
  // A provider's own mark (a letter on its brand colour), and the window's close button while the pointer is on it.
  [".sv-mark, .su-prov i, .su-opt i, .winctl .winctl-close", "a provider's brand mark; the close button on hover"],
  // The map's lines and the example drawings are pictures, not surfaces.
  [".react-flow__edges *, svg *, canvas, img, .lh-cover *, .wscene *, .sp-stage .tl .bar, .dg-dots i, .diagram *", "a picture: the map's lines, a drawing, a diagram"],
  // Drawn by the browser or by the dock, not by a stylesheet of ours.
  ["input[type=range], input[type=checkbox], input[type=radio], .dv-scrollbar", "a slider's track, a tick box, a scrollbar"],
];

const home = mkdtempSync(join(tmpdir(), "walkmycode-dark-sweep-"));
let devLog = "";
const dev = process.env.SWEEP_URL ? null : spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], {
  cwd: root,
  env: { ...process.env, WALKMYCODE_HOME: home, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
dev?.stdout.on("data", (d) => (devLog += d));
dev?.stderr.on("data", (d) => (devLog += d));
const stopDev = () =>
  new Promise((done) => {
    if (!dev || dev.exitCode !== null) return done();
    dev.once("exit", done);
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
    else dev.kill("SIGTERM");
  });

/** Runs in the page: everything painted that the flat dark theme does not allow. */
function findings({ dark, allow }) {
  const out = new Map();
  // "x" is the element itself, "x::after" its pseudo-element, "x *" everything inside it.
  const allowed = (el, pseudo) =>
    allow.some((sel) =>
      sel.split(",").some((s) => {
        const part = s.trim();
        try {
          if (part.endsWith(" *")) return !!el.parentElement?.closest(part.slice(0, -2));
          const [base, ps] = part.split("::");
          return (ps ? `::${ps}` : "") === pseudo && el.matches(base);
        } catch {
          return false;
        }
      }),
    );
  const name = (el, pseudo) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].slice(0, 4).map((c) => `.${c}`).join("")}${pseudo}`;
  const add = (el, pseudo, what) => {
    const key = `${name(el, pseudo)} — ${what}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  };
  const blurred = (shadow) => shadow.split(/,(?![^(]*\))/).some((layer) => {
    if (/inset/.test(layer)) return false;
    const px = layer.replace(/rgba?\([^)]*\)|#[0-9a-f]+|color\([^)]*\)/gi, "").match(/-?[\d.]+px/g) ?? [];
    return px.length >= 3 && parseFloat(px[2]) > 0;
  });
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    for (const pseudo of ["", "::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo || undefined);
      if (pseudo && (cs.content === "none" || cs.display === "none")) continue;
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const ok = allowed(el, pseudo);
      if (/gradient/.test(cs.backgroundImage)) add(el, pseudo, `background-image: ${cs.backgroundImage.slice(0, 60)}`);
      if (/gradient/.test(cs.maskImage || "") || /gradient/.test(cs.webkitMaskImage || "")) add(el, pseudo, "mask with a gradient");
      const m = /rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/.exec(cs.backgroundColor);
      if (m && (m[4] === undefined || +m[4] > 0) && !(+m[1] === dark[0] && +m[2] === dark[1] && +m[3] === dark[2]) && !ok) add(el, pseudo, `background-color: ${cs.backgroundColor}`);
      if (cs.boxShadow !== "none" && blurred(cs.boxShadow)) add(el, pseudo, `box-shadow: ${cs.boxShadow.slice(0, 70)}`);
      if (cs.textShadow !== "none") add(el, pseudo, `text-shadow: ${cs.textShadow.slice(0, 50)}`);
      if (/drop-shadow|blur/.test(cs.filter) || /blur/.test(cs.backdropFilter || "")) add(el, pseudo, `filter: ${cs.filter} ${cs.backdropFilter ?? ""}`);
    }
  }
  return [...out].map(([k, n]) => `${k}${n > 1 ? ` (×${n})` : ""}`);
}

const found = [];
let browser;
try {
  for (let i = 0; i < 120; i++) {
    if (await fetch(BASE).then((r) => r.ok).catch(() => false)) break;
    if (i === 119) throw new Error(`the dev server did not answer on ${BASE}:\n${devLog.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("walkmycode.theme", "dark");
    } catch {}
  });
  const page = await context.newPage();
  const allow = ALLOW.map(([sel]) => sel);
  const view = async (name) => {
    await page.waitForTimeout(900);
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "dark") found.push(`${name}: the page is not in the dark theme`);
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    const f = await page.evaluate(findings, { dark: DARK, allow });
    for (const x of f) found.push(`${name}: ${x}`);
    console.log(`${name}: ${f.length ? `${f.length} found` : "flat"}`);
  };
  const click = async (re, sel = "a, button") => {
    const el = page.locator(sel).filter({ hasText: re }).first();
    if (!(await el.count())) return false;
    await el.click({ timeout: 5000 }).catch(() => {});
    return true;
  };

  await page.goto(BASE);
  await page.waitForLoadState("networkidle").catch(() => {});
  await view("home");

  if ((await click(/^\W*Set up AI$/)) && (await page.locator(".setup").first().waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
    await view("setup-ai");
    await page.keyboard.press("Escape");
  } else console.log("setup-ai: the sheet did not open (skipped)");

  // The Set up sheet, as "Start a new project" opens it: first the question every computer is asked once
  // (the answer goes to this run's throwaway home), then the sheet.
  if (await click(/Start a new project/)) {
    const allow = page.locator("dialog[open]").getByRole("button", { name: "Allow on this computer" }).first();
    if (await allow.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
      await view("consent");
      if (!process.env.SWEEP_URL) await allow.click().catch(() => {});
    }
    if (await page.locator(".setup-sheet").first().waitFor({ timeout: 10_000 }).then(() => true, () => false)) await view("setup-sheet");
    else console.log("setup-sheet: did not open (skipped)");
    await page.keyboard.press("Escape");
  } else console.log("setup-sheet: no Start a new project here (skipped)");

  await page.goto(BASE);
  await page.waitForLoadState("networkidle").catch(() => {});
  await click(/Team Tasks/);
  await page.locator(".react-flow__node").first().waitFor({ timeout: 90_000 });
  await page.locator(".react-flow__node").nth(3).click().catch(() => {});
  await view("explore-map");

  // A file open in the Code panel, from Files.
  await page.locator(".dv-tab", { hasText: "Files" }).first().click().catch(() => {});
  await page.locator('.tree button[role="treeitem"]', { hasText: /middleware\.ts|package\.json/ }).first().click().catch(() => {});
  if (await page.locator(".cm-editor:visible").first().waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    await page.locator(".cm-editor:visible .cm-line").nth(3).click().catch(() => {});
    await view("code-panel");
  } else console.log("code-panel: no file opened (skipped)");

  await page.locator('.top [aria-label="Settings"]').first().click().catch(() => {});
  if (await page.locator(".setv").first().waitFor({ timeout: 10_000 }).then(() => true, () => false)) {
    for (const tab of (await page.locator(".setv [role=tab]").allInnerTexts()).map((t) => t.trim()).filter(Boolean)) {
      await page.locator(".setv [role=tab]", { hasText: tab }).first().click();
      await view(`settings-${tab.toLowerCase().replace(/[^a-z]+/g, "-")}`);
    }
  } else found.push("settings: did not open");

  await page.goto(`${BASE}/learn`);
  if (await page.locator(".learn").first().waitFor({ timeout: 90_000 }).then(() => true, () => false)) {
    await page.waitForLoadState("networkidle").catch(() => {});
    await view("learn-home");
    const lesson = page.locator(".lh-lesson, .lh-resume, .learn .resume").first();
    if (await lesson.count()) {
      await lesson.click().catch(() => {});
      if (await page.locator(".learn .board").first().waitFor({ timeout: 30_000 }).then(() => true, () => false)) await view("lesson-board");
      else console.log("lesson-board: no board showed (skipped)");
    } else console.log("lesson-board: no lesson to open (skipped)");
  } else found.push("learn: the room did not open");
} catch (e) {
  found.push(`the sweep itself failed: ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  await stopDev();
  rmSync(home, { recursive: true, force: true });
}

if (found.length) {
  console.log(`\n${found.length} thing(s) the flat dark theme does not allow:`);
  for (const f of found) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nThe dark theme is flat: one dark, no gradient, no shadow.");
