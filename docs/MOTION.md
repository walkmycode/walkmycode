# WalkMyCode — FINAL motion spec: "The light"

Base: the winning design ("The light", motion v13 + one persistent fixed dot). Grafted from the others: the duration-token collapse for reduced motion, search-as-highlight, the MapView memo split, native smooth scroll via `requestMeasure`, `.cm-lit-line` out of the CodeMirror theme, `.entering`/`.settling` transient classes, lane-rank trace ordering, the two-bounce tour pill, the progress-bar sibling dot, the gated zoom-to-trace. Every flaw the judges named is fixed and marked **[fix]** below.

Verified in the repo on 2026-09-30: `next 16.3.7`, `react 19.2.8` (no stable `ViewTransition`), `@xyflow/react ^12.12.0`, `@codemirror/view ^6.43.13`, `motion` **not** installed (npm latest 13.4.6, peer `react ^18 || ^19`), `next.config.ts` empty, root layout is a server component wrapping children in `div.root`. React Flow 12 renders **each edge inside its own `<svg>`** (`@xyflow/react/dist/esm/index.js:3031`), which matters for the edge rider (see 4.3). The analyzer already assigns every node an `area` (monorepo package, `src/analyzer/types.ts:36`) — that is the hook for the owner's monolith/microservice requirement (section 8).

The owner's latest message adds three requirements that this spec now covers as first-class surfaces: **(a)** the app must work for monoliths and microservice repos, **(b)** every panel must dock/undock and resize in width, **(c)** users must register. (a) and (b) change the motion system (sections 4.13–4.15, 8); (c) adds two screens (4.16). The backend work behind (a) and (c) is listed as prerequisite tasks in section 6 so motion and product land together.

---

## 1. Principles

1. **One character.** A single warm dot — the guide's light, `--yellow #f3d77a` — is the only thing that ever travels between panels (title → progress bar → brand → card → arrow → code line → chalk tip → tour pill → toggle knob). Everything else reacts to where it lands.
2. **Springs for things you touch, eases for things you read, steps for chalk.** Four named springs (`snap`, `settle`, `hop`, `glide`); tweens only for fades, stroke-draw, scroll and the chalk wipe.
3. **Cause before effect, in lane order.** Anything that lights up does so pages → routes → logic → database → outside, ≤ 1.2 s end to end, so the stagger itself teaches the request's path.
4. **Never in the way.** State is applied on frame 1; motion decorates it. No blocking waits (the connect → map handoff runs *across* the route change, not before it), every flight retargets mid-air, nothing the user must wait for exceeds 600 ms, the crowd (600+ cards) only ever transitions `opacity`.
5. **Reduce Motion is a real bookend.** One multiplier (`--m`) collapses every duration to 0 while fades stay at 150 ms; an in-app toggle whose knob *is* the light, plus the OS setting, drive CSS, Motion, React Flow and the SVG riders from the same source of truth. Lecture Hall look untouched: dark wall, green board, yellow accent, Caveat/Kalam.

---

## 2. Motion vocabulary

### 2.1 CSS custom properties (add to `:root` in `src/app/globals.css` after line 28)

```css
:root {
  --m: 1;                                   /* motion multiplier: 1 = on, 0 = reduced */
  /* durations (all collapse to 0 when --m = 0, except --t-fade) */
  --t-tap:   calc(120ms * var(--m));        /* press, hover, focus ring */
  --t-fade:  150ms;                         /* opacity-only changes: SURVIVES reduced motion */
  --t-dim:   calc(250ms * var(--m));        /* .node.dim / edge opacity & stroke-width */
  --t-move:  calc(320ms * var(--m));        /* things that travel: cards, panels, camera, progress */
  --t-draw:  calc(260ms * var(--m));        /* one arrow drawing itself */
  --t-write: calc(1100ms * var(--m));       /* one chalk line wiping in */
  --t-count: calc(600ms * var(--m));        /* cost meter */
  --t-step:  calc(70ms * var(--m));         /* stagger interval; hop delay uses --hop below */
  --hop:     calc(160ms * var(--m));        /* per-lane delay in a trace (JS clamps 120–220 ms) */
  /* easings */
  --ease-out:    cubic-bezier(.2, .8, .2, 1);       /* arrive */
  --ease-in:     cubic-bezier(.4, 0, 1, 1);         /* leave */
  --ease-settle: cubic-bezier(.22, 1, .36, 1);      /* long tail, no overshoot (camera, layout) */
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);   /* backOut, ~10 % overshoot, one bounce */
  --ease-bounce: linear(0, .28 5%, .62 10%, .92 15%, 1.09 21%, 1.11 26%, 1.04 34%, .98 42%, .99 50%, 1.01 60%, 1); /* sampled spring, two bounces */
  --ease-chalk:  steps(28, end);                    /* Lecture Hall handwriting */
}
```

### 2.2 Reduced-motion bookend **[fix: valid CSS, two blocks, one body]**

```css
@media (prefers-reduced-motion: reduce) { :root { --m: 0; } }
:root[data-motion="off"]                  { --m: 0; }
/* the few things a 0 ms duration does not cover, declared once under a shared selector */
:root[data-motion="off"] .line, :root[data-motion="off"] .chalk,
:root[data-motion="off"] .trace-dot, :root[data-motion="off"] .board.thinking::before { animation: none; }
:root[data-motion="off"] .line, :root[data-motion="off"] .chalk { clip-path: none; mask-image: none; transform: none; }
:root[data-motion="off"] .trace-dot { display: none; }
:root[data-motion="off"] .react-flow__node { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .line, .chalk, .trace-dot, .board.thinking::before { animation: none; }
  .line, .chalk { clip-path: none; mask-image: none; transform: none; }
  .trace-dot { display: none; }
  .react-flow__node { transition: none; }
}
```

`useMotionPref()` (JS) mirrors this: it returns `true` when `matchMedia('(prefers-reduced-motion: reduce)').matches || localStorage['walkmycode.motion'] === 'off'`, and it writes `data-motion="off"` on `<html>` so CSS and JS never disagree.

### 2.3 Named springs (Motion, `src/lib/motion.ts`)

```ts
export const springs = {
  snap:   { type: "spring", stiffness: 700, damping: 40, mass: 1 },    // ~180 ms, no overshoot: toggles, tab ink, pills, buttons
  settle: { type: "spring", stiffness: 380, damping: 30, mass: 1 },    // ~350 ms, ~2 % overshoot: panels, cards, selbar, dock/undock
  hop:    { type: "spring", stiffness: 260, damping: 18, mass: 0.8 },  // ~480 ms, visible bounce: the light landing, ring pop, errors
  glide:  { type: "spring", stiffness: 120, damping: 22, mass: 1 },    // ~600 ms, no overshoot: the light flying, cost roll, camera
} as const;
export const tweens = {
  swell:  { duration: 0.24, ease: "easeOut" },                          // per-property tween (never a spring with 3 keyframes) [fix]
  scroll: { duration: 0.35, ease: "easeOut" },
  count:  { duration: 0.6,  ease: "easeOut" },
};
export const hopMs = (lanes: number) => Math.min(220, Math.max(120, 1200 / Math.max(1, lanes)));
```

### 2.4 Keyframes (globals.css)

| name | definition | used by |
|---|---|---|
| `ring-pop` | `outline-offset: 6px → 1px`, 320 ms `--ease-spring` | `.node.selected` |
| `ripple` | `.node.selected::after` ring `scale(1) opacity .6 → scale(1.15) opacity 0`, 500 ms `--ease-out` forwards | select (needs `.node { position: relative }`) |
| `ignite` | `transform: scale(1.03) → 1` + `box-shadow` 0 → glow, 380 ms `--ease-spring`, `both` | `.node.lit` (≤ ~20 cards) |
| `draw` | `stroke-dashoffset: 1 → 0` on `pathLength="1"`, `--t-draw` `--ease-out`, `both` | `.trace-draw` |
| `undraw` | `stroke-dashoffset: 0 → 1`, 220 ms | clear trace |
| `ride` | `offset-distance: 0% → 100%`, `--t-draw` linear, `both` | `.trace-dot` (CSS motion path, not SMIL) |
| `line-ignite` | `background-color rgba(243,215,122,.45) → .18`, `box-shadow inset 6px → 3px`, 500 ms `--ease-out` | `.cm-editor.ignite .cm-lit-line` |
| `code-swap` | `from { opacity: .55 }`, 200 ms | code host on file change (fade only, code must not slide) |
| `orbit` | `translate` around a 6 px radius, opacity .75 ↔ 1, 1.6 s ease-in-out infinite | `.board.thinking::before` |
| `tip-breathe` | opacity .7 ↔ 1, 1.2 s | `.board .writing::after` |
| `cost-bump` | border/colour to yellow and back, `scale 1 → 1.06 → 1`, 300 ms `--ease-spring` | `.cost.bump` |
| `err-shake` | `translateX 0, -3, 3, -2, 0`, 300 ms | `.err` |
| `sheen` | `translateX(-100%) → 100%`, 1.2 s linear infinite | `.progressbar::after` while busy |

Recipes: **Rise** = `@starting-style { opacity: 0; transform: translateY(6px) }` → `opacity: 1; transform: none` with `transition: opacity var(--t-fade), transform var(--t-move) var(--ease-out)`, delay `calc(min(var(--i, 0), 12) * var(--t-step))`. **Wipe (single line)** = `clip-path: inset(0 100% 0 0) → inset(0)`, `--t-write` `--ease-chalk`. **Wipe (paragraph) [fix]** = a diagonal chalk-dust mask, not a column wipe: `mask-image: linear-gradient(100deg, #000 40%, transparent 60%); mask-size: 250% 100%; mask-position: 100% 0 → 0 0`, duration `clamp(600ms, chars * 8ms, 1600ms)`, which reveals in reading direction across wrapped lines instead of revealing every line's first word at once.

---

## 3. Library (verified)

- **`motion` 13.4.6** — `npm install motion@^13.4.6` (npm latest 13.4.6; peer deps `react ^18 || ^19`, `react-dom ^18 || ^19`; React 19.2.8 satisfies it). Do **not** add `framer-motion`. Import from `"motion/react"` only in `"use client"` files.
- Loaded as `<LazyMotion features={domMax} strict>` + `<MotionConfig reducedMotion="user">` in a client `MotionRoot` rendered by `src/app/layout.tsx` (layout stays a server component). `domMax` (≈ 4.6 kb + 25 kb gz) is required because the dock/undock surface (4.14) uses `layout` FLIP animations and the tab ink uses `layoutId`; with `strict`, only `m.*` components are allowed.
- Used APIs: `m`, `AnimatePresence` (modes `wait`, `popLayout`), `useSpring`, `useMotionValue`, `useMotionValueEvent`, `animate` (numbers and elements), `layout` / `layoutId`, `drag` (floating panels), `MotionConfig`, `useReducedMotion`. `AnimateView`/`ViewTransition` are not used (React 19.3 only).
- Everything that touches hundreds of elements (cards, edges, CodeMirror lines, tree rows) is plain CSS (`@starting-style`, transitions, keyframes keyed by `--i`/`--d` custom properties) — never Motion components, never React state per frame.
- SVG riders use the CSS motion path (`offset-path` + `offset-distance` keyframe), which honours the reduced-motion block for free; SMIL is not used **[fix]** (each React Flow edge lives in its own `<svg>`, so an SMIL `begin="Nms"` is measured from that svg's creation, and an edge that has existed longer than `begin + dur` would show a frozen rider).

---

## 4. Per-surface spec

Reduced-motion column = `--m: 0` (OS or toggle). "Light" = the continuity element of section 5.

### 4.1 Connect screen — `src/app/page.tsx`

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Page mounts | `h1` "WalkMyCode" carries the light as the tittle of the `i` (a `<span class="i">` with a hidden dot under the light). `.note` and the three `.card`s Rise with `--i` 0/1/2. Board `h2` single-line Wipe; `p` paragraph mask-wipe delayed 300 ms. Buttons live from frame 0. | Everything appears with a 150 ms fade; light sits static on the `i`. | page.tsx:73-90, 155-163; globals.css `.hall`, `.card` |
| `setBusy(...)` (page.tsx:27/60/123) | Progress card Rises. Bar is compositor-only: `<div class="progressbar"><i style="transform: scaleX(p)"/><span class="dot" style="transform: translateX(p*100%)"/></div>` with `transform-origin: left; transition: transform var(--t-move) var(--ease-settle)`; the dot is a **sibling** of the fill, never inside it **[fix: no scaleX distortion]**. `::after` sheen keeps moving while tree-sitter blocks the main thread (page.tsx:30-39). The light drops from the title onto the dot (`hop`, squash) and hands off; status text (`Mapping <file>`) is not animated. `.ctl:disabled` opacity fades over `--t-fade`. | Bar jumps, no sheen, dot static, light jumps. | page.tsx:145-152; globals.css:180-181 |
| `buildMap` resolves → `router.push('/map')` (page.tsx:40-43) | `setProgress(1)`; the light lifts off the bar dot, `animate(scale, 2.4, tweens.swell)` toward the viewport centre (24 px, the "swell"). `router.push` fires **immediately** — no wait; the light lives in the root layout and survives the route. When `MapPage` reaches `ready && repo` it calls `light.to({ el: brandEl, at: 'center', handoff: true })` + `animate(scale, 1, springs.settle)`: the light shrinks and lands as the brand's dot (`.top .brand::after`). If it arrives before `ready`, it holds (breathing) at centre until the brand exists. | Light jumps to the brand when ready; no swell. | page.tsx:40-43; map/page.tsx:152-164; layout.tsx |
| `setErr` | `.err` Rises from `translateY(-6px)` + `err-shake`. Light returns home. Never turns pink. | Fade only. | page.tsx:153 |
| Picker fallback note (page.tsx:89) | Reserve `min-height` on the row; note fades in over `--t-fade` (no post-hydration pop). | Same. | page.tsx:89 |

### 4.2 Map cards — `src/components/MapView.tsx`, globals.css:130-138

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| First paint | Map wrapper gets `.entering` for 1.2 s after mount; `.entering .node { @starting-style { opacity: 0; transform: translateY(6px) scale(.97) } transition-delay: calc(min(var(--row), 12) * 30ms) }`. `.entering` is removed afterwards so `onlyRenderVisibleElements` re-mounts during panning **never replay** the entry **[fix]**. Lane heads Wipe (400 ms). | Instant. | MapView.tsx Card :67-78, :116 |
| Hover / press | `.node:hover { transform: translateY(-1px) }`, `:active { transform: scale(.985) }`, `--t-tap`. One element at a time. | Colour only. | globals.css:130 |
| Select (`onNodeClick` :178 → map/page.tsx:60-69) | **No re-layout, no fitView** (memo split makes this structural, 4.3). `.node.selected`: outline + `ring-pop` + `::after` `ripple` on React Flow's own dot grid; the light flies to the card's left border (`glide`) and hands off to `.node.selected::before` (10 px dot on the lane-colour border). Crowd: dims at once, cards and arrows alike (§8: a transition on each cost over a second per click). Near and lit edges: `stroke-width`/`stroke` over `--t-dim`. | Outline snaps, dim is instant, no ring/ripple, light jumps. | MapView.tsx:117-123, 137; globals.css:135-137 |
| Deselect (`onPaneClick` :181) | Dims lift over `--t-dim`; light goes home. | Same, light jumps. | |
| Focus (double-click :179) / imports (:160) | Wrapper gets `.settling` for 400 ms (set in `useLayoutEffect` before the position commit **[fix]**): `.settling .react-flow__node { transition: transform var(--t-move) var(--ease-settle) }` tweens React Flow's inline `translate(x,y)`; `.react-flow__node.dragging { transition: none }`. Newly visible cards Rise (via `.entering` re-armed for 400 ms). Filtered-out cards vanish (no exit, by design). `fitView({ padding: .15, duration: 320, interpolate: 'smooth' })`. | Cards teleport as today, `fitView({ duration: 0 })`. | MapView.tsx:96-100, 146-154 |
| Search (:159) | **Search no longer filters.** Matches get `.node.hit` (border-left brightens + `ring-pop` once), non-matches `.dim`; no relayout, no unmount. After 250 ms idle (or Enter), `fitView({ nodes: hits.map(id => ({ id })), padding: .3, duration: 320 })` when `0 < hits ≤ 60`. Empty query → dims lift. | Same states, no camera tween. | MapView.tsx:91, 102, 154 |

### 4.3 Arrows and Trace — `MapView.tsx`, `src/components/LanternEdge.tsx` (new), `src/lib/store.ts`

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| `traceNode` (map/page.tsx:111-119) or tour step (:47-58) sets `lit` | **Ordering [graft]:** `trace()` also returns `main: string[]` (edge ids of the single chain: backward walk reversed + forward walk, first branch each). MapView computes per-node delay `d = (laneRank(node) − minRank) * hop` with `hop = hopMs(lanes)`, per-edge delay = delay of its lower-rank end, and writes them as `--d` on cards and edge data (changes only with `lit`, which already rebuilds the arrays). The sweep always reads pages → routes → logic → database regardless of where the trace started; ≤ 1.2 s total. **Cards:** `.node.lit { animation: ignite 380ms var(--ease-spring) var(--d) both }` — dark until its delay, then lights exactly when the rider arrives; glow stays on the lit set only. Non-lit cards `.dim`. **Edges:** registered `edgeTypes = { lantern: LanternEdge }` (module const); `LanternEdge` = `BaseEdge` + `getSmoothStepPath({ sourcePosition: Position.Right, targetPosition: Position.Left, borderRadius: 5 })`. Unlit = `BaseEdge` only. Lit adds (a) `<path d pathLength={1} class="trace-draw" style="--d">` with `draw`; (b) on `main` edges only, the **rider**: `<circle r="4" class="trace-dot" key={litKey} style={{ offsetPath: \`path("${path}")\`, '--d': d }}>` with `animation: ride var(--t-draw) linear var(--d) both` — one dot walking the chain; keyed per trace so it restarts; hidden under reduced motion by the CSS block **[fix: no SMIL]**. `animated: isLit` is removed (marching ants fought the `6 4` guess dash). **Light:** flies to the origin card, hands off, is hidden while the rider walks, reappears at the last card on completion (`animationend` on the last rider). **Camera [graft]:** only if the whole lit set is off-screen (check node rects against `getViewport()`), one `fitView({ nodes: lit, padding: .25, duration: 450, interpolate: 'smooth' })` 60 ms after `setLit`; user pan cancels it. Never on selection. | `--d` = 0 (from `--hop` 0), `ignite`/`draw` become a 150 ms opacity fade (`animation: none` + `transition: opacity var(--t-fade)`), no rider, no camera. | store.ts:123-145; MapView.tsx:126-142; LanternEdge.tsx |
| Clear trace (map/page.tsx:174-178) / end tour | `.lit` glow goes at once (the crowd does not animate, §8); `.trace-draw` runs `undraw` (no stagger); light goes home. `onTour(null)` now also `setLit(null)` **[fix: stale glow]**. "clear trace" button enters/exits with `AnimatePresence` + `m.button` (`x: 6 → 0`, `snap`). | Fade only. | map/page.tsx:174, 244 |
| Edge hover / click (:180) | `.react-flow__edge:hover .react-flow__edge-path { stroke-width: +1 }` over `--t-tap`; click = a citation: the light flies from the edge's midpoint (`labelX/labelY` from `getSmoothStepPath`) to the evidence line (4.4). | Colour only, light jumps. | MapView.tsx:180 |

### 4.4 Code highlight — `src/components/CodeView.tsx`

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| File changes (`[path, content]`, :91-129) | Editor is still destroyed/rebuilt. Host `.fill` gets `key={path}` and `code-swap` (fade only). Header `.path` (map/page.tsx:197) `key={open?.path}` fades. Scroll stays instant (`scrollIntoView`) — nothing to scroll from. | Same (fade is opacity). | CodeView.tsx:122-123, 142 |
| `highlight` changes, same file (:131-140) | `.cm-lit-line` **moves out of `EditorView.theme`** (its `!important` blocks transitions and keyframes **[fix]**) into globals.css: `.code .cm-line.cm-lit-line { background: rgba(243,215,122,.18); box-shadow: inset 3px 0 0 var(--yellow); transition: background-color var(--t-move), box-shadow var(--t-move) }` + `@starting-style { .code .cm-line.cm-lit-line { background: transparent; box-shadow: inset 0 0 0 var(--yellow) } }` — recycled lines merely re-fade (harmless) instead of replaying a keyframe. **Ignite:** `.cm-editor.ignite .cm-lit-line { animation: line-ignite 500ms var(--ease-out) }`, class added for 600 ms after the scroll lands, so later-rendered lines get only the static style. **Scroll:** `v.requestMeasure({ read: () => v.lineBlockAt(pos).top, write: top => v.scrollDOM.scrollTo({ top: Math.max(0, top - 60), behavior: reduced ? 'auto' : 'smooth' }) })`; if `|Δ| > 3000 px` jump. Then `const c = v.coordsAtPos(pos)` → `light.to({ x: gutterRight, y: c.top + lineH/2 })`, `hop` landing, handoff to the gutter bar. | `scrollIntoView` as today, no ignite class, bar fades in 150 ms, light jumps. | CodeView.tsx:34, 131-140; globals.css `.code` |
| Selection → selbar (map/page.tsx:206-229) | `AnimatePresence mode="wait"`: the "lines a–b selected" span and the two buttons Rise with `settle`, buttons delayed 40/80 ms; hint text fades out 120 ms. `.ctl:active { transform: scale(.97) }`. | Fade only. | map/page.tsx:206-229 |

### 4.5 Chalkboard — `src/components/Guide.tsx` (Chalk :32-48), globals.css:94-115

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Streaming answer (`onText` :119) | **No per-delta animation.** The stream is the typewriter. While `busy`, the last block gets `.writing`; `.board .writing::after` is the **chalk tip**: an inline 6 px yellow dot with glow at the text end, `tip-breathe`. The light flies to the board's first line when a job starts and hands off to the tip (it follows the text end for free, being inline). Completed blocks never re-animate. **No wipe on streaming blocks [fix: the first block mounts empty]**. | Tip static, no breathe. | Guide.tsx:32-48, 146 |
| Whole text arrives (welcome :155-160, tour title/say :147-154, "Tour ready", errors) | `h2` = single-line Wipe (`.line`); paragraphs = diagonal mask-wipe (`.chalk`, duration by length) **[fix: no column-wise reveal]**; stagger 0/100/200 ms; tour `say` keyed on `step`. | 150 ms fade. | Guide.tsx:147-160 |
| Tool ticker (`looked at:` :166) | Each name is a `<span class="tool">` with `@starting-style { opacity: 0; transform: translateX(4px) }`, 180 ms; `small` keeps a fixed line-height so no layout jump. | Fade. | Guide.tsx:166 |
| Turn roll-off (`turns.slice(-3)` :162) | `AnimatePresence initial={false}` around turns, oldest exits `{ opacity: 0, height: 0 }` 250 ms. | Instant. | Guide.tsx:162 |
| Auto-scroll (:137-139) | `scrollTo({ top, behavior: busy || reduced ? 'auto' : 'smooth' })` — instant while streaming (no jitter against the growing block), smooth once when the answer lands or a step changes. | `'auto'`. | Guide.tsx:137-139 |

### 4.6 Thinking — Guide.tsx:111-134, :146; globals.css:114-115

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| `busy` true | The blinking "…" is replaced by the light **orbiting** top-right of the board: light flies there (`glide`), hands off to `.board.thinking::before` (8 px dot, `orbit`). First text delta → orbit fades 120 ms, chalk tip fades in 120 ms (4.5). Input placeholder/`disabled` fade `--t-fade`; "stop" enters/exits via `AnimatePresence` (`snap`, `scale .9 → 1`). Remove `@keyframes blink`. | Static dot, 2 s opacity pulse only. | Guide.tsx:146, 202-210 |
| Answer complete / abort (`finally` :134) | Beacon fades `--t-fade`; the light reappears at the last citation in the answer, else goes home. Guide error: `.err` replaces Chalk with a 150 ms crossfade + `err-shake`. | Fade. | Guide.tsx:130-134, 168 |

### 4.7 Tour — Guide.tsx:147-192; map/page.tsx:47-58

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Tour ready (:125-128) | Last answer fades out 150 ms (`AnimatePresence mode="wait"`), title Wipe, step line Rise, `say` mask-wipe. `.panel.steps` player Rises from `translateY(8px)` with `settle`; pills stagger 30 ms. | Fade. | Guide.tsx:174-192 |
| Step change (`onStep`) | All overlapping, ≈ 600 ms: (1) pills are **CSS**, not `layoutId` **[fix: no layoutId inside the `display:none` wrapper]**: `.progress button { transition: width var(--t-move) var(--ease-bounce), background var(--t-dim) } .progress button.on { width: 28px; background: var(--yellow) }` — the active pill stretches with a two-bounce spring; the light hops onto it first (200 ms) then leaves for the code; (2) code: 4.4 smooth scroll + ignite; (3) map: `setLit` with `main` built from `node_ids` order (first named node first); (4) `say` re-wipes keyed on `step`. `next ›` `:active` scale. | Pill width snaps, everything else per its surface. | Guide.tsx:176-184; map/page.tsx:47-58 |
| End tour (:188) | Player exits downward (`AnimatePresence`, 200 ms), board crossfades 150 ms, `lit` cleared → glow fades. | Fade. | Guide.tsx:188; map/page.tsx:244 |

### 4.8 Citations — Guide.tsx:77-87, :151; Inspector.tsx:86, :43

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Click `.cite` / path button / inspector row | `.cite:active { transform: scale(.96) }`; 200 ms underline sweep to solid yellow. The light **departs from the cite**: `light.to({ from: cite.getBoundingClientRect(), … })` jumps to the cite then springs to the code line resolved after CodeView applies the highlight (`coordsAtPos`; fallback = code panel header rect). Open/scroll happen on frame 1 regardless. | Underline instant, light jumps. | Guide.tsx:82; Inspector.tsx:43, 86 |

### 4.9 Cost meter — new `src/components/CostMeter.tsx` (replaces map/page.tsx:179-181)

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| `addUsage` (client.ts:45, once per tool round) | `v = useSpring(0, springs.glide)`; `useEffect(() => v.set(cost.usd), [cost.usd])`; `useMotionValueEvent(v, 'change', n => ref.current.textContent = '$' + n.toFixed(3))` (direct DOM write, no re-render). `calls` plain. Pill `cost-bump` per change; the light blinks 120 ms wherever it is. `aria-live="polite"` with the final value. | `v.jump(cost.usd)`, colour flash only. | CostMeter.tsx; cost.ts:33-42 |

### 4.10 Tabs and side panels — map/page.tsx:231-245

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| `setTab` (click or programmatic :57/:66/:100/:106/:124/:143) | Tab ink = `<m.span layoutId="tab-ink" transition={springs.snap} className="ink" />` inside the active button (`position: absolute; bottom: -2px; height: 2px; background: var(--yellow)`); tabs are always rendered, so this `layoutId` is safe. Panel flex: `flex: 0 1 auto` vs `1 1 auto` + `transition: flex-grow var(--t-move) var(--ease-settle)`. Inspector/FileTree Rise on mount; Guide returns via `@starting-style` fade (`display:none` gets no exit, by design). | Ink jumps, no flex transition, fades only. | map/page.tsx:232-243; globals.css:177-179 |
| Inspector rows (Inspector.tsx:34-67, 122-138) | `style={{ '--i': i }}` → the first ten rows of each list Rise with `calc(min(var(--i), 10) * 25ms)`; the rest are simply there (§8). Row click → light to code; name click → light to card. `.edge:hover` bg transitions `--t-tap`. | Fade, no stagger. | Inspector.tsx |
| File tree (FileTree.tsx:44-53) | Children Rise (120 ms, no stagger); glyph is one `▸` with `transform: rotate(90deg)` over `--t-tap` `--ease-spring`; `.on` colour `--t-fade`. | Fade. | FileTree.tsx:45 |
| Workspace first paint | `.work > * { @starting-style { opacity: 0; transform: translateY(10px) } }`, `settle`, `--i` 0/1/2. Brand pops in (`scale .85 → 1`). | Fade. | globals.css:118 |

### 4.11 Motion toggle — new `src/components/MotionToggle.tsx`

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Click "motion" pill (top bar, next to cost) | 34 × 18 px track, 12 px knob. Turning motion **off**: the light flies into the track (`hop`), squashes, becomes the knob (handoff to `.mtoggle i`), then `data-motion="off"` is set on `<html>` and `localStorage['walkmycode.motion'] = 'off'`. Turning **on**: knob springs across (`snap`), light lifts off to the brand. `'auto'` follows the OS setting. Video 1's bookend and Video 2's escaping knob. | Knob jumps (it is the reduced state). | MotionToggle.tsx; motion.ts |

### 4.12 Errors everywhere

`.err`: Rise from `translateY(-6px)` + `err-shake` once; light goes home; nothing loops. Reduced: fade.

### 4.13 Resizable panel widths — new `src/components/Dock.tsx` (owner requirement)

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Drag a `.gutter` (6 px, `cursor: col-resize`) between columns | `.work { grid-template-columns: var(--w-map) 6px var(--w-code) 6px var(--w-side) }`; pointermove writes the two adjacent vars **directly** on `.work.style` (no React state per frame), min 240 px each; `.work.resizing { user-select: none } .work.resizing * { transition: none !important }` so React Flow/CodeMirror track 1:1. pointerup persists `{ widths }` to `localStorage['walkmycode.layout']` and fires one `fitView({ duration: 0 })`. The gutter shows a 2 px yellow line on hover/drag (`--t-tap`). | Same (drag is direct manipulation). | Dock.tsx; globals.css `.work`, `.gutter` |
| Double-click a gutter | Reset to defaults with `transition: grid-template-columns var(--t-move) var(--ease-settle)` (animatable when track counts match; Chromium 107+/Firefox; falls back to a jump). | Jump. | Dock.tsx |
| Window < 1200 px | Existing grid reflow, not animated. | — | globals.css:120 |

### 4.14 Dock / undock panels (owner requirement)

Every panel header (map, code, guide/tabs) gets an "undock" button (⧉) and, when floating, a "dock" button (⧈) plus a header drag handle and a corner resize handle.

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Undock | Panel state `{ mode: 'dock' | 'float', rect }` in `DockProvider` (persisted with the widths). The panel element keeps its React identity (same tree position; only class/style change) so React Flow and CodeMirror are **never remounted**. It is an `m.section layout="position"` (translate-only FLIP, `settle`; no scale so the map/editor are not distorted) that switches to `position: fixed` inside a `.floats` layer above `.work`; width/height are set from `rect` with a one-time `transition: width var(--t-move), height var(--t-move)` (one element, 320 ms). The vacated grid column collapses (`--w-x: 0px` + the same grid transition) so the other panels grow. The light hops onto the floating panel's header dot (`.panel.float header::before`) — "the light follows the panel". Floating panels: `drag dragMomentum={false} dragConstraints={workRef} dragListener={false}` with `dragControls.start(e)` from the header; corner handle writes width/height directly (no transitions while resizing); `z-index` raises on pointerdown. | FLIP disabled by `reducedMotion="user"`; sizes jump; drag still works. | Dock.tsx; map/page.tsx:186-247; globals.css `.floats`, `.panel.float` |
| Dock | Reverse: column reopens, panel FLIPs back (`settle`), light returns to the brand. | Jump. | Dock.tsx |
| Escape / double-click header | Docks the panel. | — | Dock.tsx |

Out of scope for this spec (listed as an optional later task): a true pop-out into a separate browser window (`window.open` + portal), because React Flow and CodeMirror need their own document's stylesheets and resize observers there.

### 4.15 Repo shape: monolith or microservices (owner requirement)

> **Superseded for layout by `docs/SERVICES.md` (30 Sep); choreography unchanged.** The map no longer splits lanes into service bands by `area`: `MapView` has three views — `all` (today's lanes, the only view a monolith or monorepo gets), `system` (one card per service) and `service` (one service's lanes plus portal cards) — laid out by the pure `layoutFor(map, view)` in `src/components/mapLayout.ts`. Service boundaries come from `map.services` (compose, Kubernetes, Dockerfiles, workspaces), not from `area`, and cross-service links are `calls-route`/`calls-rpc`/`publishes`/`consumes` edges with evidence, not `kind: 'calls'`. What still applies from the table below: the rider's **leap** and the light's "+1 lane" delay apply when a trace crosses from one `service` to another (`store.ts` `trace()` already restarts the layer order there and returns the services it passes); the "band label ignite" becomes the destination breadcrumb crumb or service card; the connect screen's "N services found" chips count `map.services` of kind app. Durations, easings and reduced-motion rules are unchanged.

The map must read the same whether the repo is one app or many services. The analyzer already tags every node with `area` (monorepo package); for a monolith `map.areas.length === 1` and nothing below applies.

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Map mounts with `areas.length > 1` | Each lane is split into **service bands**: cards grouped by `area` with a small band label (`.band`, uppercase mono, lane colour at 60 %) rendered as a non-draggable React Flow node above the group; bands Wipe with the lane heads (400 ms, +40 ms per band). Positions stay a pure function of `[map, visible]`. | Instant. | MapView.tsx layout memo |
| Trace crosses a service boundary (`uses-service`/HTTP edge whose ends have different `area`) | The rider does a **leap**: the `trace-dot` gets `--leap: 1` → `animation: ride var(--t-draw) linear var(--d) both, leap var(--t-draw) var(--ease-spring) var(--d)` (`leap`: `r 4 → 6 → 4`), the destination band label ignites (`.band.lit` yellow, 150 ms), and the light's delay table treats a service hop as +1 lane so the sweep still reads left to right. | No rider; band label fades. | LanternEdge.tsx; store.ts delays |
| Analysing a multi-service repo (connect screen) | Status line adds "N services found" and, on completion, N small chips (`.chip`, one per area) Rise with `--i` stagger before the handoff. | Fade. | page.tsx:145-152 |

Prerequisite (not motion, section 6 task 14): the analyzer must resolve cross-service calls (client `fetch('/api/x')`/HTTP calls in area A matched to route definitions in area B; `docker-compose.yml`/`services/*` manifests as extra area roots) into edges with `kind: 'calls'` across areas instead of dead-ending at an external `service` node.

### 4.16 Registration and sign-in (owner requirement) — new `src/app/(auth)/register/page.tsx`, `sign-in/page.tsx`

| Trigger | Motion | Reduced | File |
|---|---|---|---|
| Page mounts | Same `.hall` shell as connect: `h1` "WalkMyCode" with the light as the tittle; one `.panel.card` with the form; fields Rise with `--i` 0..n (cap 6); board `h2`/`p` ("Why an account") Wipe. | Fade. | (auth)/register/page.tsx |
| Field focus | `:focus-visible` ring is instant (never animated); label colour `--t-fade`. | — | globals.css |
| Submit | Primary button `:active` scale; the light drops into the button (`hop`) and becomes its busy dot (`.ctl.busy::after`, `tip-breathe`) while the request runs; button `disabled` fades. | Light jumps. | register/page.tsx |
| Success | Light swells (`tweens.swell` to 2.4) and the page lifts (`.hall.leaving { opacity: 0; transform: translateY(-6px) }` 200 ms `--ease-in`); `router.push('/')` fires immediately; the light lands on the connect `h1` tittle when it mounts (same handoff mechanism as connect → map). | Fade, light jumps. | |
| Validation / auth error | Field border → pink over `--t-fade`; `.err` Rise + `err-shake`; the light returns to the tittle. | Fade. | |
| Signed-in state | Top bar shows the user's initial in a 24 px pill next to the motion toggle; "sign out" is a `.ctl compact`. No motion beyond `.ctl`. | — | map/page.tsx top bar |

Prerequisite (section 6 task 15): an auth layer (route handlers `/api/auth/register`, `/api/auth/sign-in`, `/api/auth/sign-out`; hashed passwords; HTTP-only session cookie; a `proxy.ts`/middleware redirect from `/` and `/map` to `/sign-in` when unauthenticated). Auth.js is acceptable; the motion spec does not depend on the choice.

---

## 5. The continuity element — exact mechanism

**Files:** `src/lib/light.ts` (store), `src/components/LanternLight.tsx` (the element), `src/components/MotionRoot.tsx` (mounts it once), `src/lib/motion.ts` (springs, `useMotionPref`).

**Element.** One `<m.span className="light" aria-hidden />` rendered by `MotionRoot` inside `src/app/layout.tsx`, so it survives `router.push` (connect → map, register → connect). CSS: `position: fixed; left: 0; top: 0; width: 10px; height: 10px; border-radius: 50%; background: var(--yellow); box-shadow: 0 0 0 4px rgba(243,215,122,.18), 0 0 18px 4px rgba(243,215,122,.45); pointer-events: none; z-index: 1000; will-change: transform`. It is driven only by motion values, never React state: `x = useSpring(0, springs.glide)`, `y = useSpring(0, springs.glide)`, `scale = useMotionValue(1)`, `scaleY = useMotionValue(1)`, `opacity = useMotionValue(1)`, bound via `style={{ x, y, scale, scaleY, opacity }}`. `x/y` are viewport coordinates of the dot's centre minus 5 px.

**Store** (`light.ts`, same listener pattern as `store.ts`):

```ts
export type LightTarget = {
  el?: HTMLElement | SVGElement;     // measured with getBoundingClientRect() when the target arrives
  x?: number; y?: number;            // or explicit viewport coords (CodeMirror coordsAtPos, edge label point)
  at?: 'center' | 'left' | 'right' | 'top';   // anchor within el's rect (default center)
  from?: DOMRect;                    // jump here first (citations: depart from the clicked word)
  spring?: 'glide' | 'hop';          // travel spring (default glide)
  land?: boolean;                    // squash on arrival (default true)
  handoff?: boolean;                 // fade out on arrival while the surface's beacon fades in
  hold?: boolean;                    // stay visible after landing (e.g. centre swell while a route loads)
};
export const light = { to(t: LightTarget), park(), hide(), subscribe(fn) };
```

**Flight.** On `to()`: if `from`, `x.jump(from.cx); y.jump(from.cy)`. Resolve the destination rect (`el.getBoundingClientRect()` is in viewport coordinates, so it already includes React Flow's viewport transform and any panel scroll). `x.set()/y.set()` with the chosen spring — a new target mid-flight simply retargets the springs (they carry velocity, so the path curves; rapid clicks never queue). Arrival is detected with `useMotionValueEvent(x, 'animationComplete')`; then the **landing**: `animate(scaleY, [1, .72, 1.08, 1], tweens.swell)` (squash, Video 1's tittle drop). If `handoff`, `animate(opacity, 0, { duration: .12 })` while the surface's beacon fades in over the same 120 ms; every beacon is a pseudo-element that scrolls/pans with its surface, so the fixed dot is only ever visible during a flight (≤ 600 ms) and stale-position bugs cannot accumulate.

**Beacons** (all `content: ""`, 8–10 px, `var(--yellow)`, the same glow): `.top .brand::after` (home on `/map`), `h1 .i::after` (home on `/` and auth pages), `.progressbar .dot::before`, `.node.selected::before`, `.cm-lit-line` inset bar, `.board.thinking::before` (orbit), `.board .writing::after` (chalk tip), `.progress button.on` (pill fill), `.mtoggle i` (toggle knob), `.panel.float header::before` (undocked panel), `.ctl.busy::after` (submit button).

**Home and idle.** `light.park()` flies to the current page's home (`[data-light="home"]`, queried at call time). Called when nothing is selected, lit or thinking. After 4 s without motion events `animate(opacity, .6, { duration: .6 })`.

**Panels.** Map: `<ReactFlow onMove={() => light.hide()}>` — the fixed dot cannot track a moving viewport; the card's `::before` beacon stays. Code: destination = `view.coordsAtPos(doc.line(n).from)` (null → code header rect); computed after the smooth scroll settles (`scrollend` on `scrollDOM`, fallback 400 ms). Guide: destination = `boardRef` first line rect (`at: 'left'`) then handoff to the orbit/tip. Floating/resized panels need nothing special (rects are always read live).

**Route handoff.** Before `router.push`, `light.to({ x: innerWidth/2, y: innerHeight/2, hold: true })` + `animate(scale, 2.4, tweens.swell)`; the receiving page calls `light.to({ el: home, handoff: false })` + `animate(scale, 1, springs.settle)` from a `useEffect` on `ready`. No wait is inserted before the push.

**Reduced motion.** `useMotionPref()` → `x.jump()/y.jump()`, no squash, opacity fades only (150 ms), `hold` ignored, `hide()` unchanged.

---

## 6. Ordered implementation tasks (each verifiable alone in the browser)

Cheapest visible wins first. Tasks 1–7 add **no dependency**.

1. **Tokens + bookend** — `globals.css`: add the `:root` tokens (2.1) and both reduced-motion blocks (2.2); `.ctl { transition: transform var(--t-tap), background var(--t-dim), border-color var(--t-dim), color var(--t-dim), opacity var(--t-fade) } .ctl:hover:not(:disabled) { transform: translateY(-1px) } .ctl:active { transform: scale(.97) }`; `.node.dim` + `.react-flow__edge-path` transitions; `.node:hover/:active`. *Verify:* click a card → the crowd dims smoothly; toggle OS reduce-motion → dims still fade, nothing else moves.
2. **Connect screen** — `page.tsx` + css: progress bar `scaleX` fill + sibling `.dot` + sheen; `.card` Rise with `--i`; `.err` shake; picker note `min-height`; board `h2` Wipe + `p` mask-wipe. *Verify:* load the demo; bar keeps moving while the tab is busy; no layout pop from the picker note.
3. **Chalkboard** — `Guide.tsx` + css: `.line`/`.chalk` classes on welcome/tour/title text; `.writing` chalk tip on the last block while busy; thinking `::before` dot + `orbit` (delete `blink`); tool ticker spans; `scrollTo` behaviour switch. *Verify:* ask a question; orbit → tip handoff; no scroll jitter while streaming.
4. **Code** — `CodeView.tsx` + css: move `.cm-lit-line` to globals.css with transition + `@starting-style`; `ignite` class 600 ms; `requestMeasure` smooth scroll for same-file moves; host `key={path}` + `code-swap`; header `.path` keyed. *Verify:* click two citations in one file → smooth scroll and bar ignites; open another file → 200 ms fade, instant scroll.
5. **Side panels** — `map/page.tsx`, `Inspector.tsx`, `FileTree.tsx`, css: CSS tab underline (temporary `::after scaleX` until task 9 swaps in `layoutId`), `flex-grow` transition, Rise on `.inspect`/`.tree`, `--i` rows, rotating `▸`, `.work > *` first-paint Rise, brand pop. *Verify:* switch tabs, open Details on a busy node → rows stagger ≤ 250 ms.
6. **Map layout hygiene** — `MapView.tsx`: split the memo into `layout` (`[map, visible]`) and `rfNodes/rfEdges` (`[layout, selected, lit, hits]`); search → `hits` (no filter) + `.node.hit` + 250 ms debounced `fitView({ nodes })`; fitView effect deps → `[focus, showImports]` with `duration: reduced ? 0 : 320, interpolate: 'smooth'`; `.entering` (1.2 s) and `.settling` (400 ms, `useLayoutEffect`) wrapper classes; `.react-flow__node` transition rules; `onlyRenderVisibleElements={map.nodes.length > 400}`; `data.row` for entry delay. *Verify:* type in search → no teleport, hits pop, camera glides once; double-click a card → survivors slide; drag a card → 1:1.
7. **Trace choreography** — `store.ts` (`trace()` returns `main`), `LanternEdge.tsx` (new: BaseEdge + draw overlay + CSS-motion-path rider keyed per trace), `MapView.tsx` (`edgeTypes`, `type: 'lantern'`, drop `animated`, lane-rank `--d`, gated zoom-to-trace), `map/page.tsx` (`onTour(null)` clears `lit`; `AnimatePresence` can wait for task 8 — use CSS Rise for "clear trace" for now). *Verify:* Trace it from a logic node → UI lights first, arrows draw in order, one dot walks the chain, whole sweep ≤ 1.2 s; end tour → glow fades; reduced motion → everything lights at once, no dot.
8. **Install motion + MotionRoot + pref** — `npm i motion@^13.4.6`; `src/lib/motion.ts` (springs, tweens, `hopMs`, `useMotionPref`, `setMotionPref`); `MotionRoot.tsx` (`LazyMotion domMax strict` + `MotionConfig reducedMotion="user"`, applies `data-motion`); wrap children in `layout.tsx`; `MotionToggle.tsx` in the top bar (CSS knob for now). *Verify:* toggle off → `<html data-motion="off">`, every animation from tasks 1–7 collapses; `next build` size delta ≈ 30 kb gz.
9. **Presence + ink** — `map/page.tsx`, `Guide.tsx`: `AnimatePresence` around "clear trace", "stop", selbar content, tour player, turn roll-off; `m.span layoutId="tab-ink"`; CSS tour pill (`--ease-bounce` width). *Verify:* select lines → selbar springs in and out; 4th question → board does not jump; tab ink slides on programmatic tab flips.
10. **The light** — `light.ts`, `LanternLight.tsx`, beacons in css, `data-light="home"` on `h1 .i` and `.top .brand`; hooks: connect busy → bar dot; before `router.push` → centre swell; map `ready` → brand; `onNodeClick` → card left; `onPaneClick` → park; citation/inspector/edge → code line after scroll; job start → board; step → pill; `onMove` → hide; toggle knob handoff. *Verify:* one dot, never two, across load → select → cite → ask → tour; pan the map mid-flight → the dot hides, the card beacon stays; reduced → jumps only.
11. **Cost meter** — `CostMeter.tsx` with `useSpring` + `useMotionValueEvent`, `cost-bump`, `aria-live`. *Verify:* after a tool round the number rolls over 600 ms and the pill bumps once.
12. **Resizable widths** — `Dock.tsx` (`Gutter`), `.work` grid vars, persistence, double-click reset transition. *Verify:* drag gutters → React Flow and CodeMirror follow 1:1 with no transitions; reload keeps widths; double-click animates back.
13. **Dock / undock** — `Dock.tsx` (`DockProvider`, `DockPanel`, `.floats` layer), header buttons, `m.section layout="position"` + `drag`, corner resize, persistence, Escape to dock, light hop to the floating header. *Verify:* undock the code panel → it floats with a translate-only FLIP, the map grows, the editor keeps its scroll position and selection; dock it back; reduced → jumps.
14. **Service bands (analyzer prerequisite + motion)** — *Layout per `docs/SERVICES.md`; choreography unchanged.* The analyzer half is done on the `services` branch (SERVICES.md §9 tasks 1–12) and the views are `all`/`system`/`service` rather than bands; what remains here is the motion only: `--leap` on riders whose edge crosses services, the destination crumb/card ignite, and the chips. Original text, kept for the motion details: `src/analyzer/build.ts`: extra area roots (`docker-compose` services, `services/*`, `apps/*`, `packages/*`), cross-area call resolution to `kind: 'calls'` edges; `MapView.tsx`: band nodes when `areas.length > 1`, `--leap` on cross-area riders, band label ignite; `page.tsx`: "N services found" chips. *Verify:* index a multi-service demo → bands per service, a trace leaps between them; the single-area demo is unchanged.
15. **Registration (auth prerequisite + motion)** — `/api/auth/*` route handlers + session cookie + middleware redirect; `(auth)/register` and `(auth)/sign-in` pages with the 4.16 motion; user pill + sign-out in the top bar. *Verify:* unauthenticated `/map` redirects; register → light drops into the button → swells → lands on the connect title; wrong password → shake, no redirect.
16. **Models beyond Anthropic (owner's earlier ask, non-motion)** — `src/lib/providers.ts` (registry + `providerFor`), `route.ts` branch (Anthropic beta stream unchanged; OpenAI-compatible streamer for OpenAI/DeepSeek/Gemini with `base_url`), neutral message shape in `client.ts`, per-model `PRICES` in `cost.ts`, provider + model `<select>` pair in the top bar (provider change resets the model to `default_model`), `.env.example`/README. Motion tie-ins already provider-agnostic (cost bump, orbit).

---

## 7. Verification checklist (running app)

**Motion on (OS default, toggle "auto")**
- [ ] Connect: cards rise staggered; board writes itself (h2 single-line wipe, paragraph diagonal wipe); nothing blocks clicking.
- [ ] Analyse the demo: the light drops onto the bar's dot; bar and sheen keep moving during parsing (tab is otherwise frozen); the dot is round at 10 % and 90 % (not squashed by scaleX).
- [ ] Handoff: the light swells at the centre, the route changes underneath, it lands on the brand dot once the map is ready; total feels ≈ 500 ms; "Loading…" is still shown.
- [ ] Map first paint: cards fade in by row (≤ 360 ms); pan afterwards → newly rendered cards do **not** replay the entry.
- [ ] Select a card: ring pops, ripple once, light lands on the left border, crowd dims (at once), map does **not** move; click the pane → dims lift, light returns to the brand.
- [ ] Search: cards never teleport; hits pop; camera glides once after typing stops; clear → dims lift.
- [ ] Double-click focus: survivors slide; camera tween ≈ 320 ms; drag a card → no lag.
- [ ] Trace from a **logic** node: UI card lights first, then API, logic, data; arrows draw in that order; exactly one dot walks the chain; guess edges keep their dash; sweep ≤ 1.2 s; camera moves only if the lit set was off-screen.
- [ ] Trace twice quickly: the second trace restarts cleanly (no leftover riders). Clear trace: glow and draws fade, button exits.
- [ ] Citation in the same file: light departs from the word, smooth scroll ≤ 350 ms, gutter bar ignites once; scroll away and back → the bar does **not** re-ignite.
- [ ] Citation to another file: 200 ms fade, instant scroll, ignite.
- [ ] Ask: light orbits top-right; first token → orbit fades, chalk tip appears at the text end; streaming never smooth-scrolls; answer end → light lands on the last citation.
- [ ] 4th question: oldest turn collapses (no jump). Error answer: pink line, one shake.
- [ ] Tour: player rises; each step: light hops to the pill (which stretches with two bounces), then to the code, map cards ignite in `node_ids` order, say text wipes; end tour → glow fades, board crossfades.
- [ ] Tabs: ink slides, including when a map click flips to Details; Details rows stagger ≤ 250 ms; tree glyph rotates.
- [ ] Cost pill rolls and bumps once per tool round; screen reader reads the final value.
- [ ] Resize: gutters drag 1:1, persist across reload, double-click animates back.
- [ ] Undock code → floats with a translate-only FLIP, editor state intact; drag by header; corner resize; Escape docks; light rides to the floating header.
- [ ] Multi-service repo: bands per service; a trace leaps across a band with the band label lighting.
- [ ] Register: fields stagger; submit → light becomes the button's busy dot → swell → lands on the connect title; bad input → shake.
- [ ] Performance: with the 600-node map, select and trace stay ≥ 55 fps in the Performance panel; no per-frame React commits (React Profiler) during flights, cost roll or scroll; `next build` shows ≈ 30 kb gz added.
- [ ] Verify once: React Flow `fitView` `duration` is ms (320 reads as ~0.3 s); `offset-path` on an SVG `<circle>` animates in the owner's browser (if not, fall back to `<animateMotion begin="indefinite">` + `beginElementAt(d/1000)` in a `useEffect`); `grid-template-columns` transition on double-click reset (falls back to a jump).

**Reduced motion (toggle "off", then OS setting with toggle "auto")**
- [ ] `<html data-motion="off">` present; every flight is a jump; no ring pop, ripple, ignite, draw, rider, sheen, orbit, wipe, stagger, camera tween, FLIP or pill bounce.
- [ ] Still perceivable: dims, glows, tab ink, selbar, panels and errors change with a 150 ms fade; chalk text appears whole; the thinking dot pulses opacity only; the cost number updates instantly with a colour flash.
- [ ] The toggle's knob is the light (static) while off; turning motion on springs the knob across and the light lifts off to the brand.
- [ ] Nothing in the app is unreachable or delayed in this state; all flows (analyse, select, trace, cite, ask, tour, dock, resize, register) complete identically.

---

## 8. What NOT to animate

- Card **positions on select/deselect** — never; only focus/imports re-layouts tween, and only under `.settling`.
- **Exit of filtered-out cards** on focus — React Flow drops their DOM; they vanish.
- **The crowd's shadows, borders, gradients** — no `will-change` on 600 elements, no permanent glow pseudo-elements on every card.
- **The crowd's opacity either** (measured on the 626-card map, docs/PERFORMANCE.md): an opacity transition on every card and SVG arrow, plus a shadow transition each time the zoom crossed the far threshold, cost several full-map style recalculations per click and a `transitionend` storm per zoom. Dimming is instant; only cards and arrows in play animate.
- **Long lists** — only the first ten rows of a Details list rise; each transition also sends React three events.
- **Anything per frame from the main thread over the map** — the light is a Web Animation of `translate`/`scale`/`opacity` (the spring sampled into keyframes once per flight, `src/lib/lightDom.ts`): writing its transform every frame re-layerized the whole page. Its targets are measured after the next frame's layout, and flights asked for in one click coalesce into the last (`light.ts`), so it never forces style or layout; hidden targets are found from the DOM, not `checkVisibility`.
- **`:has()` over the dock, or custom properties on the map's box** — both restyle every element under them (sash drags use a class on `<html>`; a trace's `--hop` sits on each lit element).
- **Unlit edges** — no transitions beyond stroke-width/opacity, no dots, no draws; arrowheads (`markerEnd`) never (not transitionable).
- **Streaming text per delta** — no per-token wipe, no smooth scroll while streaming, no wipe on the still-growing block.
- **The analysis status text** and the top-bar stats line.
- **Layout properties** except the three deliberate one-offs (`flex-grow` on tab switch, `grid-template-columns` on gutter reset, float `width/height` on dock/undock).
- **Panels during a resize drag** — transitions off, 1:1 tracking.
- **The Guide when `display:none`** — no exit; state preservation wins.
- **Colour as mood** — the light is always yellow; lanes are lanes; pink is error text only.
- **Anything longer than 600 ms the user must wait for** — the trace sweep (≤ 1.2 s) and chalk wipes (≤ 1.6 s) are decorative and clickable-through.

Files: codebase-guide\package.json, codebase-guide\src\app\layout.tsx, codebase-guide\src\app\globals.css, codebase-guide\src\lib\motion.ts, codebase-guide\src\lib\light.ts, codebase-guide\src\lib\store.ts, codebase-guide\src\components\MotionRoot.tsx, codebase-guide\src\components\LanternLight.tsx, codebase-guide\src\components\LanternEdge.tsx, codebase-guide\src\components\MotionToggle.tsx, codebase-guide\src\components\CostMeter.tsx, codebase-guide\src\components\Dock.tsx, codebase-guide\src\components\MapView.tsx, codebase-guide\src\components\CodeView.tsx, codebase-guide\src\components\Guide.tsx, codebase-guide\src\components\Inspector.tsx, codebase-guide\src\components\FileTree.tsx, codebase-guide\src\app\page.tsx, codebase-guide\src\app\map\page.tsx, codebase-guide\src\app\(auth)\register\page.tsx, codebase-guide\src\app\(auth)\sign-in\page.tsx, codebase-guide\src\app\api\auth\, codebase-guide\src\analyzer\build.ts, codebase-guide\src\lib\providers.ts, codebase-guide\src\app\api\claude\route.ts, codebase-guide\src\lib\claude\client.ts, codebase-guide\src\lib\cost.ts

---

## Design panel record

Ranking: [["The WalkMyCode Dot: a CSS-first motion system for WalkMyCode (zero new dependencies)",106],["WalkMyCode motion design: \"The light\" (motion v13 + LazyMotion/domMax, external light store)",55],["WalkMyCode motion design: \"The light\" (motion v13 LazyMotion+domMax, one persistent fixed dot)",53],["WalkMyCode motion design: \"Narrative physics\" with one yellow light (motion v13 LazyMotion+domAnimation, one-shot flyDot)",50],["WalkMyCode motion design: \"Narrative physics\" with one yellow light (motion v13 + domAnimation, useAnimate)",50]]
Designs: ["WalkMyCode motion design: \"The light\" (motion (motion/react) v13.4.6 — LazyMotion + domMax + `m` components, useSpring/useMotionValue/animate, MotionConfig reducedMotion=\"user\"; plus plain CSS (@starting-style, transitions, keyframes) for everything that touches hundreds of elements; SVG <animateMotion> for the light riding an edge. No ViewTransition/AnimateView (installed React is 19.2.8, not 19.3).)","The WalkMyCode Dot: a CSS-first motion system for WalkMyCode (zero new dependencies) (none — CSS transitions/keyframes, @starting-style, linear() spring easings, clip-path chalk wipes, stroke-dashoffset arrow draws in a React Flow custom edge, SVG animateMotion for the dot; ~40 lines of vanilla JS in total (one matchMedia gate, one CodeMirror scrollTo, one 220 ms hand-off wait))","WalkMyCode motion design: \"Narrative physics\" with one yellow light (motion v13.4.6 (import from \"motion/react\": LazyMotion + m + domAnimation, useAnimate() sequences, animate() for number/scroll tweens, useReducedMotion) for app chrome and sequencing; plain CSS (transitions, @starting-style, keyframes with a --i stagger variable) for everything inside React Flow nodes and CodeMirror lines; SVG pathLength stroke-draw + <animateMotion><mpath> for lit edges only. No GSAP, no framer-motion, no React ViewTransition (React is 19.2.8, ViewTransition is stable only in 19.3).)"]
