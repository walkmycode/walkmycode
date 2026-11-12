# docs/PERFORMANCE.md: how fast the map is, and how to measure it

The owner's complaint was that WalkMyCode felt very slow. On the iReliabee demo (626 cards and 1,024 arrows on the full map), `next dev` took 11.8 s to "show everything" and 6.0 s to answer a click on a card. This page records what the map costs on a **production build**, before and after the speed work, and how to measure it again.

A note on `next dev`: it runs React's development build, with StrictMode rendering everything twice, and without minification. It is 5 to 20 times slower than production for this app, so judge speed with `next build && next start`, never in dev.

## Results

Measured on 30 September 2026 on a Lenovo laptop: Windows 11 Pro (build 26200), 12th Gen Intel Core i7-1255U, 16 GB, Chrome 153.0.8010.55 headless through Playwright 1.63, Node 24.8. **before** is commit `6310ede`; **after** is commit `2fab527`, master with the performance pass merged. Medians of 5 runs at normal speed and of 3 runs at 4x CPU slowdown, in milliseconds unless it says fps. The full map has 626 cards and 1,024 arrows in the DOM in both builds.

| | before | after | before, 4x CPU | after, 4x CPU |
|---|---|---|---|---|
| Connect screen: first paint | 252 | 260 | 928 | 960 |
| Map a picked folder (the demo's 286 files): total / longest freeze | 3,997 / 2,736 | 5,908 / 0 | 34,906 / 24,033 | 8,775 / 160 |
| Reload `/map`: first card drawn | 860 | 882 | 1,573 | 2,667 |
| Show everything: frame / settled | 338 / 706 | 352 / 352 | 4,729 / 8,331 | 3,537 / 4,249 |
| Click a card: frame / settled | 409 / 409 | 59 / 189 | 5,740 / 7,137 | 559 / 2,626 |
| Click another card: frame / settled | 348 / 477 | 45 / 325 | 2,096 / 3,846 | 263 / 2,154 |
| Hover a card: frame | 17 | 17 | 17 | 16 |
| Trace it: frame / settled | 221 / 221 | 34 / 34 | 3,630 / 5,731 | 132 / 219 |
| Clear trace: frame / settled | 425 / 425 | 176 / 176 | 3,759 / 3,759 | 384 / 384 |
| Pan (drag): fps / longest frame | 8 fps / 283 | 57 fps / 133 | 8 fps / 817 | 21 fps / 433 |
| Zoom (wheel): fps / longest frame | 21 fps / 300 | 27 fps / 233 | 9 fps / 483 | 13 fps / 467 |

Reading the table:

- **Mapping a folder.** The total is the noisiest number here (3.3 to 6.1 s before and 4.1 to 6.2 s after, run to run, at normal speed); what changed is the freeze. Before, the page stopped answering for most of the mapping. After, at normal speed, no task on the page's thread reached 50 ms (the long-task threshold, so the freeze reads 0), and at 4x the longest was 160 ms. Chrome's CPU throttling slows the page's main thread; the analyzer now runs in a worker on its own thread, so the 4x mapping total for the new build is not a four-times-slower-laptop number the way the others are.
- **Clicking a card.** The frame is what the click feels like: the ring is painted in 45 to 60 ms instead of 350 to 410. The new build's settled time includes opening the clicked card's code in a CodeMirror editor, which follows the ring as a transition (item 4 below); before, the editor opened in the same render as the ring.
- **Hover** is CSS only in both builds and costs one frame.
- **Pan** went from 8 to 57 frames per second, the display's rate. Zoom gained less, 21 to 27, and is the slowest interaction left in the table.

## Method

Both builds are measured by the same script, one after the other on the same machine:

- **before**: commit `6310ede` (the master this work branched from), exported with `git archive`, installed with `npm ci`, built, and served on port 3101.
- **after**: this branch, built and served on port 3100.

```
npm run build
npx next start -p 3100
node scripts/perf.mjs --runs 5                       # the table's 1x column
node scripts/perf.mjs --runs 3 --cpu 4               # a laptop four times slower
node scripts/perf.mjs --base http://localhost:3101   # another build
```

`scripts/perf.mjs` drives the Chrome installed on the machine through Playwright (`channel: "chrome"`, headless; it falls back to Playwright's Chromium, installed with `npx playwright install chromium`). It needs the demo's `.walkmycode/ireliabee.map.json` and `.walkmycode/ireliabee.files.json` (copy them from the main checkout; they are not in git). Each run uses a fresh browser profile at 1600×1000 and:

1. Paints the connect screen (first contentful paint).
2. Clicks "add to workspace" on the demo and then "Map it": the demo's 286 files are mapped as if they were a picked folder. It records the total time and the longest the page froze (the longest main-thread task).
3. Opens the demo, goes to the system view, and reloads `/map` (the workspace comes back from IndexedDB).
4. Clicks "show everything", clicks a card, clicks another, hovers one, clicks "Trace it", "clear trace", and the empty map.
5. Drags the map in a circle from a point with nothing on it (a drag that starts on an arrow does not pan; the script checks the map moved), and wheels in and out.

Every click is timed in the page, from just before the click to:

- **frame**: the first frame painted after it (a `requestAnimationFrame` then a task);
- **settled**: the end of the last long task it caused (the main thread is quiet for 600 ms after), or the frame if there was none.

Pan and zoom report frames per second over the whole gesture and the longest frame. The table gives the median of the runs.

The machine these numbers come from is shared with other work (its CPU sat around 60 % busy), so single runs vary by up to half; the medians, and before against after taken back to back, are what to compare. `--cpu 4` uses Chrome's CPU throttling.

`scripts/perf-profile.mjs everything|click|trace|pan|zoom` records a Chrome trace and a CPU profile of one of these interactions and prints where the main thread's time went (script, style, layout, layerize, paint, hit testing) and the hottest functions. `--eval "<js>"` runs something in the page first, and `perf.mjs --css "<rules>"` adds styles, for trying a change without a rebuild.

## What was slow, and what changed

In order of how much each one mattered.

1. **Every click rebuilt every card and arrow.** `MapView` made 1,650 new React Flow node and edge objects whenever the selection or the trace changed, so React Flow re-adopted all of them and redrew every card and every arrow (each arrow its own `<svg>`, its smooth-step path worked out again). Now the objects are made once per layout. What is selected, lit and dimmed lives in a small store (`src/components/mapHighlight.ts`); each card and arrow subscribes to its own classes, so a click redraws only the cards and arrows whose classes change (the old and new neighbourhood or trace, a few dozen), and the dimming of everything else is one class on the map's box (`hl-near`, `hl-lit`) that CSS acts on. The handlers React Flow hands to every card's wrapper keep their identity too, so a click does not redraw the wrappers.
2. **1,024 arrows, each its own React Flow edge.** Each was its own `<svg>`, its own store subscription (its position worked out again on every pan and zoom step) and its own markers. On the lanes, all the arrows are now one `<svg>` inside React Flow's edge layer, paths worked out once when the cards are measured, arrowheads defined once per colour. Lit and neighbouring arrows move to a layer on top, as their raised z-index did before. The system view's few dozen labelled arrows stay React Flow edges.
3. **Panning repainted the whole map every frame.** While the map is dragged, its viewport is a GPU layer of its own (`will-change: transform` only during the drag, so it is painted sharp again after). Zooming out past half size drops the cards' drop shadows (a pixel or two wide there, and costly to redraw on every zoom step); a lit card keeps its glow. The cards' invisible React Flow handles are gone (the lane arrows do not need them), which is 1,250 fewer positioned elements to lay out and hit-test.
4. **Every panel redrew on every click.** All the room's state is one context, so a click redrew the guide, the file tree, every open editor and the details. The panels now return memoised content keyed on what they show, and `askFree` no longer changes identity with the selection. Opening the clicked card's code (a new CodeMirror editor) is a transition, so the ring on the map is painted first and the editor follows a frame later.
5. **Linear scans.** `nodeById`, `edgesOf`, `neighbourhood` and `trace` scanned the whole map (`trace` scanned every edge at every step of its walk). `src/lib/mapIndex.ts` builds, once per map object, nodes and edges by id and each node's edges in and out, in map order, so the walks give exactly the same answers (the trace's depth limit depends on walk order); `tests/mapIndex.test.ts` checks them against the old scans on the fixtures, random maps and, when it is present, the iReliabee map.
6. **Mapping a folder froze the page.** The analyzer ran on the page's thread. It now runs in a Web Worker (`src/analyzer/build.worker.ts`, started by `buildInWorker.ts`, which falls back to the page's thread if a worker cannot start); the progress bar keeps moving and the page answers while it maps.

Also fixed on the way: a map tab behind another tab in the same group showed through it (React Flow marks each measured card `visibility: visible`, which beat the hidden tab's `visibility: hidden`), and was painted while hidden.

## Not done

- **Zoom** is the slowest thing left (27 fps at 1x, 13 fps at 4x): every wheel step re-composites the cards' layers. Options: a lighter card while zooming (the `far` class already drops shadows), or rendering the zoomed-out map to a canvas.
- **Reload of `/map`** at 4x CPU (2.7 s) is dominated by reading the workspace out of IndexedDB and the first dockview layout; nothing is done about it yet.
- **"Show everything" at 4x CPU** still takes 3.5 s to the first frame: 626 cards are mounted in one go. Mounting the crowd in slices (visible lanes first) would bring the first frame down.
- **Click "settled" times** include the editor opening the file (a CodeMirror mount); the click itself paints in under 60 ms.
- Motion (docs/MOTION.md) lands after these numbers; re-run the script after it and add a row here.

## The fly-through (1 October 2026)

Measured on 1 October 2026 on the same laptop, with Edge 154.0.4258.48 headless through Playwright 1.63 (Chrome is not installed there now; `perf.mjs` falls back to Edge, or takes `--channel msedge`), medians of 3 runs at normal speed. **before** is commit `8a8a3a1` (master before the fly-through), **after** is the fly-through branch; both were built and served on port 3110 in turn. The machine was shared with other sessions, so single numbers move by up to half; compare the medians.

| | before | after |
|---|---|---|
| Click a card: frame / settled | 66 / 201 | 59 / 182 |
| Click another card: frame / settled | 54 / 331 | 47 / 260 |
| Trace it: frame / settled | 49 / 49 | 41 / 41 |
| Clear trace: frame / settled | 47 / 47 | 45 / 45 |
| Pan (drag): fps / longest frame | 58 fps / 100 | 58 fps / 83 |
| Zoom (wheel): fps / longest frame | 34 fps / 183 | 42 fps / 117 |
| Go to a card by name (Ctrl+K, a name, Enter): Enter → the camera's first move / painted | 298 / 355 (the palette's jump) | 41 / 64 |
| Fly-through by names ("components/CalendarView to calendar_events", 4 hops): Enter → first move | – | 12 |
| Fly-through: fps over the whole flight / longest frame | – | 47 fps / 400 |

How the fly-through stays fast:

- **The camera moves first.** A name is matched as you type (`src/lib/flyPath.ts`, no AI); on Enter the camera's glide (React Flow's own `setCenter`, 400 ms × `--m`, straight, eased) starts before React draws the selection, and the code opens when the camera has arrived.
- **One hop, three beats**: the camera glides, then the light rides the arrow and the card it reaches ignites, then the code opens at the hop's lines. Building a CodeMirror editor (60 to 250 ms) never lands in a glide or a ride.
- **Glides at one zoom only composite.** The viewport becomes its own GPU layer after the first glide and keeps it for the whole flight, so later hops between nearby cards ran at 60 fps (25 frames in 420 ms); a layer made and dropped for every hop cost more than it saved. A glide that zooms repaints (so nothing is drawn blurred); the first one, from the whole map in to a readable zoom, and a long jump across services (new tiles to raster) run at 15 to 25 fps in this headless, software-rendered browser.
- **The map never fits itself under a fly-through** (`flyThrough.ownsCamera()`): a view switch, a hidden tab shown again or the panel changing height (a longer breadcrumb) would otherwise refit the map in the middle of a glide.

`scripts/perf.mjs` now times "go to a card by name" and a fly-through by names (`--fly "<a> to <b>"`), and `scripts/perf-profile.mjs fly` records one fly-through.
