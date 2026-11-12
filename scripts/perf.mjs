// Times the map on a production build (docs/PERFORMANCE.md). Drives Chrome
// through Playwright against a running server:
//
//   npm run build && npx next start -p 3100
//   node scripts/perf.mjs [--base http://localhost:3100] [--demo team-tasks] [--runs 3] [--headed]
//
// Needs the demo's .walkmycode/<name>.map.json and .files.json. Uses the Chrome
// installed on this machine (channel "chrome"); falls back to Playwright's own
// Chromium (`npx playwright install chromium`).
//
// Every interaction reports two numbers:
//   frame   – from the click to the first frame painted after it
//   settled – from the click until the main thread is quiet again (the end of
//             the last long task, or the frame if there were none)
import { chromium } from "playwright";
import { emptySpot } from "./perf-spot.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const BASE = arg("base", "http://localhost:3100");
const DEMO = arg("demo", "team-tasks");
const RUNS = Number(arg("runs", "3"));
const HEADED = process.argv.includes("--headed");
const CPU = Number(arg("cpu", "1"));
/** Well-connected cards of the demo's map (the first one found on the page is used). */
const CARDS = ["file:lib/tasks.ts", "file:lib/db.ts", "file:lib/auth.ts"];
const OTHER = ["file:components/TaskList.tsx", "file:app/page.tsx"];

// In the page: long tasks, and a helper that times one action.
const INSTRUMENT = () => {
  window.__lt = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, end: e.startTime + e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* no long task API */
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  /** Run `act` (sync), then wait for `done()` and for 600 ms without a long task. */
  window.__time = async (act, done, timeout = 60000) => {
    await frame();
    await frame();
    const t0 = performance.now();
    act();
    await frame();
    const tFrame = performance.now();
    let tDone = done() ? tFrame : 0;
    while (performance.now() - t0 < timeout) {
      if (!tDone && done()) tDone = performance.now();
      const lastEnd = Math.max(0, ...window.__lt.filter((x) => x.end > t0).map((x) => x.end));
      if (tDone && performance.now() - Math.max(lastEnd, tDone) > 600) {
        return { frame: tFrame - t0, done: tDone - t0, settled: Math.max(tFrame, tDone, lastEnd) - t0, longTasks: window.__lt.filter((x) => x.start >= t0).length };
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { frame: tFrame - t0, done: tDone ? tDone - t0 : NaN, settled: NaN, longTasks: -1, timedOut: true };
  };
  /** Count frames from start to stop. */
  window.__fpsStart = () => {
    const f = { t0: performance.now(), n: 0, worst: 0, last: performance.now(), on: true };
    window.__frames = f;
    const tick = (t) => {
      if (!f.on) return;
      f.n++;
      f.worst = Math.max(f.worst, t - f.last);
      f.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  window.__fpsStop = () => {
    const f = window.__frames;
    f.on = false;
    const t = performance.now();
    return { fps: (f.n * 1000) / (t - f.t0), worstFrame: Math.max(f.worst, t - f.last) };
  };
};

/** First contentful paint of the page now loaded (it can be reported a little after load). */
const fcp = (page) =>
  page
    .waitForFunction(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime, null, { timeout: 5000 })
    .then((h) => h.jsonValue())
    .catch(() => NaN);
const nodes = (page) => page.evaluate(() => document.querySelectorAll(".react-flow__node").length);

/** The home page's card for the indexed demo ("Pick up where you left off": the one
 * without Edit, which is the folder mapped above), or its example card, or the connect
 * screen's button before the home redesign. */
const exampleButton = (page) =>
  page
    .locator("article.mcard")
    .filter({ has: page.getByRole("button", { name: `Open the map of ${DEMO}`, exact: true }) })
    .filter({ hasNot: page.locator(".mcard-edit") })
    .locator(".mcard-hit")
    .or(page.locator("button.ex", { hasText: new RegExp(DEMO.replace(/^example-/i, "").replace(/[-_]+/g, " "), "i") }))
    .or(page.getByRole("button", { name: DEMO, exact: true }))
    .first();

async function openDemo(page) {
  await page.goto(`${BASE}/`);
  const t0 = Date.now();
  await exampleButton(page).click();
  await page.waitForURL("**/map**");
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
  return Date.now() - t0;
}

/** "A to B" for the fly-through measure: two cards the go-to bar resolves by name, joined by
 * real arrows (frontend page → backend route → logic → table on the demo's map). */
const FLY = arg("fly", DEMO === "team-tasks" ? "components/TaskList to lib/db" : "");

/** In the page: press Enter in the open go-to bar and time the camera's first move. */
const ENTER_AND_TIME = () =>
  new Promise((resolve) => {
    const vp = document.querySelector(".dock-panel.map .react-flow__viewport");
    const input = document.querySelector(".palette input");
    if (!vp || !input) return resolve({ move: NaN, paint: NaN });
    const before = vp.style.transform;
    let t0 = 0;
    const mo = new MutationObserver(() => {
      if (vp.style.transform === before) return;
      const t1 = performance.now();
      mo.disconnect();
      requestAnimationFrame(() => resolve({ move: t1 - t0, paint: performance.now() - t0 }));
    });
    mo.observe(vp, { attributes: true, attributeFilter: ["style"] });
    setTimeout(() => {
      mo.disconnect();
      resolve({ move: NaN, paint: NaN });
    }, 5000);
    t0 = performance.now();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  });

/** Open the go-to bar (Ctrl+K) with `text` typed in, the matches drawn. */
async function typeInBar(page, text) {
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette input");
  await page.fill(".palette input", text);
  await page.waitForTimeout(400);
}

/** Ctrl+K, a card's name, Enter: the time to the camera's first move. */
async function goTo(page, ids) {
  const name = await page.evaluate(
    (ids) =>
      ids
        .map((id) => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"] .nm`)?.textContent?.trim())
        .find((t) => t && [...document.querySelectorAll(".react-flow__node .nm")].filter((e) => e.textContent?.trim() === t).length === 1),
    ids,
  );
  if (!name) return { move: NaN, paint: NaN };
  await typeInBar(page, name);
  return page.evaluate(ENTER_AND_TIME);
}

/** "A to B" in the go-to bar: the first move, then fps over the whole flight. */
async function flyThrough(page, text) {
  await typeInBar(page, text);
  await page.evaluate(() => window.__fpsStart());
  const first = await page.evaluate(ENTER_AND_TIME);
  // Until the fly-through bar says it has arrived (or 15 s).
  await page.waitForFunction(() => document.querySelector(".flybar")?.dataset.status === "done", null, { timeout: 15000 }).catch(() => {});
  const fps = await page.evaluate(() => window.__fpsStop());
  const hops = await page.evaluate(() => Number(document.querySelector(".flybar")?.dataset.steps ?? NaN));
  return { ...first, ...fps, hops };
}

async function run(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  // --cpu 4: a laptop four times slower than this machine.
  if (CPU > 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const out = {};

  // The connect screen: first contentful paint.
  await page.goto(`${BASE}/`);
  out.connectFcp = await fcp(page);

  // Map the demo's files as if they were a picked folder: how long, and the longest the page froze.
  // The home page: "Add several", then the demo's chip ("+ team-tasks"); before it, "add to workspace".
  const several = page.getByRole("button", { name: "Add several (web + API)" });
  if (await several.count()) {
    await several.click();
    await page.getByRole("button", { name: `+ ${DEMO}`, exact: true }).click();
  } else await page.getByRole("button", { name: "add to workspace" }).first().click();
  await page.getByRole("button", { name: "Map it" }).and(page.locator(":enabled")).waitFor();
  await page.evaluate(INSTRUMENT);
  const tMap = Date.now();
  const since = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Map it" }).click();
  await page.waitForURL("**/map**", { timeout: 300000 });
  out.mapFolder = Date.now() - tMap;
  out.mapFolderFreeze = await page.evaluate((since) => Math.max(0, ...window.__lt.filter((x) => x.start >= since).map((x) => x.end - x.start)), since).catch(() => NaN);

  out.openDemo = await openDemo(page);
  // Start from the system view, with a clean layout.
  await page.evaluate(() => (location.hash = "system"));
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length < 100);

  // /map first paint on reload (the workspace comes back from IndexedDB).
  await page.reload();
  const t0 = Date.now();
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
  out.mapReload = Date.now() - t0;
  out.mapFcp = await fcp(page);
  await page.evaluate(INSTRUMENT);
  // --css "<rules>": extra styles, for trying a change without a rebuild.
  if (arg("css")) await page.addStyleTag({ content: arg("css") });
  await page.waitForTimeout(800);

  // "show everything"
  out.showEverything = await page.evaluate(() =>
    window.__time(
      () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "show everything").click(),
      () => document.querySelectorAll(".react-flow__node").length > 300 && document.querySelectorAll(".react-flow__edge").length > 300,
    ),
  );
  out.shownNodes = await nodes(page);
  out.shownEdges = await page.evaluate(() => document.querySelectorAll(".react-flow__edge").length);
  await page.waitForTimeout(800);

  // Click one card.
  const pick = (ids) => page.evaluate((ids) => ids.find((id) => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)), ids);
  const card = await pick(CARDS);
  const other = await pick(OTHER);
  if (!card || !other) throw new Error("no card to click");
  const click = (id) =>
    page.evaluate(
      (id) =>
        window.__time(
          () => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`).click(),
          () => !!document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"] .selected`),
        ),
      id,
    );
  out.clickCard = await click(card);
  await page.waitForTimeout(500);
  out.clickOther = await click(other);
  await page.waitForTimeout(500);

  // Hover over a few cards (CSS only, but the frame still has to come).
  out.hover = await page.evaluate(async (id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    return window.__time(
      () => {
        el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      },
      () => true,
    );
  }, card);

  // Trace it (the button in Details).
  out.trace = await page.evaluate(() =>
    window.__time(
      () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Trace it").click(),
      () => document.querySelectorAll(".node.lit").length > 1,
    ),
  );
  await page.waitForTimeout(500);
  out.clearTrace = await page.evaluate(() =>
    window.__time(
      () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().toLowerCase() === "clear trace").click(),
      () => !document.querySelector(".node.lit"),
    ),
  );
  await page.waitForTimeout(500);
  // Click the empty map: the selection goes.
  out.clickPane = await page.evaluate(() =>
    window.__time(
      () => document.querySelector(".react-flow__pane").click(),
      () => !document.querySelector(".react-flow__node .selected"),
    ),
  );
  await page.waitForTimeout(500);

  // Pan and zoom: frames per second while dragging and wheeling over the whole map.
  // Frames are counted over the whole drag (or wheel), however long it takes.
  const { x: cx, y: cy } = await emptySpot(page);
  const transform = () => page.evaluate(() => document.querySelector(".dock-panel.map .react-flow__viewport")?.style.transform);
  const before = await transform();
  await page.mouse.move(cx, cy);
  await page.evaluate(() => window.__fpsStart());
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx + Math.sin(i / 6) * 200, cy + Math.cos(i / 6) * 120);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  out.pan = await page.evaluate(() => window.__fpsStop());
  const panned = await transform();
  if (panned === before) throw new Error("the drag did not pan the map");
  await page.evaluate(() => window.__fpsStart());
  let zoomed = panned;
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, i < 20 ? -60 : 60);
    await page.waitForTimeout(25);
    if (i === 19) zoomed = await transform();
  }
  out.zoom = await page.evaluate(() => window.__fpsStop());
  if (zoomed === panned) throw new Error("the wheel did not zoom the map");
  await page.waitForTimeout(500);

  // Go to a card by name (Ctrl+K, type its name, Enter): from the Enter to the first
  // move of the camera, and to the frame painted after it (docs/PLAN.md "Fly-through":
  // the first move within 100 ms of a name match).
  out.goTo = await goTo(page, [...OTHER, ...CARDS]);
  await page.waitForTimeout(1200);

  // A fly-through by names ("A to B", resolved in the page with no AI): frames per
  // second while the camera glides card to card and the light runs along each arrow.
  if (FLY) out.fly = await flyThrough(page, FLY);

  await ctx.close();
  return out;
}

// --channel msedge (or chrome): the browser installed on the machine; without it, Chrome,
// then Edge, then Playwright's own Chromium, whichever launches first.
const CHANNELS = arg("channel") ? [arg("channel")] : ["chrome", "msedge", undefined];
async function launch() {
  let last;
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ ...(channel ? { channel } : {}), headless: !HEADED });
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const browser = await launch();
const results = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run(browser);
  results.push(r);
  console.error(`run ${i + 1}:`, JSON.stringify(r));
}
await browser.close();

const med = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const ms = (x) => (Number.isFinite(x) ? `${Math.round(x)} ms` : "n/a");
const rows = [
  ["Connect screen first paint (FCP)", ms(med(results.map((r) => r.connectFcp)))],
  ["Map the demo's files as a folder: total / longest freeze", `${ms(med(results.map((r) => r.mapFolder)))} / ${ms(med(results.map((r) => r.mapFolderFreeze)))}`],
  ["Open the demo → system view drawn", ms(med(results.map((r) => r.openDemo)))],
  ["/map reload → first card (IndexedDB restore)", ms(med(results.map((r) => r.mapReload)))],
  ["/map reload FCP", ms(med(results.map((r) => r.mapFcp)))],
  ["show everything: frame / settled", `${ms(med(results.map((r) => r.showEverything.frame)))} / ${ms(med(results.map((r) => r.showEverything.settled)))}`],
  ["click a card: frame / settled", `${ms(med(results.map((r) => r.clickCard.frame)))} / ${ms(med(results.map((r) => r.clickCard.settled)))}`],
  ["click another card: frame / settled", `${ms(med(results.map((r) => r.clickOther.frame)))} / ${ms(med(results.map((r) => r.clickOther.settled)))}`],
  ["hover a card: frame", ms(med(results.map((r) => r.hover.frame)))],
  ["Trace it: frame / settled", `${ms(med(results.map((r) => r.trace.frame)))} / ${ms(med(results.map((r) => r.trace.settled)))}`],
  ["clear trace: frame / settled", `${ms(med(results.map((r) => r.clearTrace.frame)))} / ${ms(med(results.map((r) => r.clearTrace.settled)))}`],
  ["click the empty map: frame / settled", `${ms(med(results.map((r) => r.clickPane.frame)))} / ${ms(med(results.map((r) => r.clickPane.settled)))}`],
  ["pan (drag), fps / worst frame", `${med(results.map((r) => r.pan.fps)).toFixed(0)} / ${ms(med(results.map((r) => r.pan.worstFrame)))}`],
  ["zoom (wheel), fps / worst frame", `${med(results.map((r) => r.zoom.fps)).toFixed(0)} / ${ms(med(results.map((r) => r.zoom.worstFrame)))}`],
  ["cards / arrows in the DOM on the full map", `${med(results.map((r) => r.shownNodes))} / ${med(results.map((r) => r.shownEdges))}`],
  ["go to a card by name: Enter → first camera move / painted", `${ms(med(results.map((r) => r.goTo?.move)))} / ${ms(med(results.map((r) => r.goTo?.paint)))}`],
  ...(results.some((r) => r.fly)
    ? [
        ["fly-through by names: Enter → first camera move", ms(med(results.map((r) => r.fly?.move)))],
        ["fly-through: hops, fps / worst frame", `${med(results.map((r) => r.fly?.hops))}, ${med(results.map((r) => r.fly?.fps)).toFixed(0)} / ${ms(med(results.map((r) => r.fly?.worstFrame)))}`],
      ]
    : []),
];
console.log(`\nMedian of ${RUNS} runs, ${BASE}, demo ${DEMO}, CPU slowdown ${CPU}x\n`);
console.log("| measure | result |\n|---|---|");
for (const [k, v] of rows) console.log(`| ${k} | ${v} |`);
