"use client";
// Hotspots on the map (docs/GIT.md, "Hotspots", mockup Hotspots.dc.html): "Colour by: Kind | Hotspots" on
// the map's toolbar, the window picker beside it, the legend, and the Details panel's list of the
// hottest files. What git says comes from the user's own git, the way line history does
// (src/ide/localrun/git/FileGit.tsx): in the desktop app read-only from the folder it opened, with no
// "run code on this computer" (POST /api/git/read); in the full app through the local-run socket and
// its consent, once WalkMyCode knows the project's folder. The scoring is src/lib/hotspots.ts.
//
// One store for the page, so the map and Details agree: which colouring, which span, and what git
// said for each span of this workspace (asked again only for a span not read yet). With no git, or
// nothing changed in the span, a plain message stands in place of the legend and the map stays
// coloured by kind.
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { CodeMap } from "@/analyzer/types";
import { useDesktop } from "@/lib/desktop";
import { DEFAULT_SPAN, heatOf, hotNote, hotTour, SPAN_SHORT, SPAN_WORDS, SPANS, testsImporting, whyHotContext, type Churn, type Heat, type Span } from "@/lib/hotspots";
import type { GitFileCommit } from "@/lib/localrun/git";
import { openSetup, pillState } from "@/lib/aiPill";
import { useAiStatus } from "@/lib/aiStatus";
import { TARGET } from "@/lib/adapters/target";
import { nodeById, useWorkspace } from "@/lib/store";
import { gitOp, LOCAL_BUILD, setupRoot } from "@/ide/localrun/client";
import { useConsent } from "@/ide/localrun/Consent";
import { useLocalStatus } from "@/ide/localrun/OutputArea";
import { readChurn, readGit } from "@/ide/localrun/git/readGit";
import { useShell } from "@/shell/WorkspaceProvider";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "none"; why: string };
interface State {
  /** The workspace this is about (a new one starts afresh). */
  key: string | null;
  mode: "kind" | "hot";
  span: Span;
  status: Status;
  churn: Partial<Record<Span, Churn>>;
}

const IDLE: Status = { kind: "idle" };
let state: State = { key: null, mode: "kind", span: DEFAULT_SPAN, status: IDLE, churn: {} };
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => state;
/** This workspace's state: a workspace not seen before starts coloured by kind. */
const forKey = (key: string | null): State => (state.key === key ? state : { key, mode: "kind", span: state.span, status: IDLE, churn: {} });

type ChurnAnswer = { ok: true; churn: Churn } | { ok: false; why: string };
type ChurnSource = (span: Span) => Promise<ChurnAnswer>;

const nothingIn = (span: Span) => `No commit changed this project in ${SPAN_WORDS[span]}. Pick a longer span.`;

/** Colour by Hotspots over `span`: what git said for it before, or ask git now. */
async function showHot(key: string | null, span: Span, get: ChurnSource) {
  const mine = forKey(key);
  const had = mine.churn[span];
  if (had) return set({ ...mine, span, mode: had.commits ? "hot" : "kind", status: had.commits ? { kind: "ready" } : { kind: "none", why: nothingIn(span) } });
  set({ ...mine, span, status: { kind: "loading" } });
  const r = await get(span);
  // Something newer was asked for meanwhile (another span, Kind, another workspace).
  if (state.key !== key || state.span !== span || state.status.kind !== "loading") return;
  if (!r.ok) return set({ mode: "kind", status: { kind: "none", why: r.why } });
  const churn = { ...state.churn, [span]: r.churn };
  if (!r.churn.commits) return set({ churn, mode: "kind", status: { kind: "none", why: nothingIn(span) } });
  set({ churn, mode: "hot", status: { kind: "ready" } });
}

/** Back to colouring by kind (and the arrows' legend). */
function showKind(key: string | null) {
  set({ ...forKey(key), mode: "kind", status: IDLE });
}

/** The heat for a churn, worked out once per map (the map and Details both ask). */
const heats = new WeakMap<Churn, { map: CodeMap; heat: Heat }>();
function heatFor(map: CodeMap, churn: Churn, texts: Record<string, string>): Heat {
  const had = heats.get(churn);
  if (had?.map === map) return had.heat;
  const heat = heatOf(map, churn, texts);
  heats.set(churn, { map, heat });
  return heat;
}

/** Where Hotspots stand for the workspace on screen. `hot`: the map is coloured by them now. */
export function useHotspots() {
  const ws = useWorkspace();
  const key = ws?.id ?? null;
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const mine = all.key === key ? all : forKey(key);
  const { map, repoView } = useShell();
  const churn = mine.status.kind === "ready" ? mine.churn[mine.span] : undefined;
  const heat = useMemo(() => (churn ? heatFor(map, churn, repoView.files) : null), [map, churn, repoView.files]);
  return { key, mode: mine.mode, span: mine.span, status: mine.status, heat, hot: mine.mode === "hot" && !!heat };
}

/** The user's own git for this workspace, as line history reaches it (FileGit.tsx): the desktop app's
 * folder read-only, else the local-run socket once allowed. `dialog` is the consent dialog to render. */
function useGitSource() {
  const local = useLocalStatus();
  const ws = useWorkspace();
  const workspace = ws?.name;
  const desktop = useDesktop();
  const picked = ws?.repos.find((r) => r.path)?.path ?? null;
  const folder = desktop ? picked : null;
  const available = LOCAL_BUILD && !!local?.available;
  const allowed = !!local?.allowed;
  const { ask, dialog } = useConsent();

  const churn = useCallback<ChurnSource>(
    async (span) => {
      try {
        if (folder) {
          const r = await readChurn(folder, span);
          return r.ok && r.churn ? { ok: true, churn: r.churn } : { ok: false, why: r.output || "git couldn't read this project's history." };
        }
        if (!available) return { ok: false, why: "Hotspots read the project's git history on this computer, which this page can't reach. Open the project in the WalkMyCode app or the desktop app." };
        if (!allowed && !(await ask())) return { ok: false, why: "Hotspots need to read the project's git history on this computer. Allow it to see them." };
        let r = await gitOp({ op: "churn", span, ...(workspace ? { workspace } : {}) });
        if (!r.located && workspace && picked && (await setupRoot(workspace, picked)).ok) r = await gitOp({ op: "churn", span, workspace });
        if (!r.located) return { ok: false, why: "WalkMyCode doesn't know where this project is on this computer yet: open Source Control in the top bar and give it the project's folder." };
        if (!r.ok || !r.churn) return { ok: false, why: r.output || "git couldn't read this project's history." };
        return { ok: true, churn: r.churn };
      } catch (e) {
        return { ok: false, why: (e as Error).message };
      }
    },
    [folder, available, allowed, ask, workspace, picked],
  );

  /** A file's commits, without asking for anything (Hotspots were allowed already); null when unreadable. */
  const fileLog = useCallback(
    async (path: string): Promise<GitFileCommit[] | null> => {
      try {
        if (folder) return (await readGit("file-log", folder, path)).history ?? null;
        if (!allowed) return null;
        const r = await gitOp({ op: "file-log", path, ...(workspace ? { workspace } : {}) });
        return r.ok ? (r.history ?? null) : null;
      } catch {
        return null;
      }
    },
    [folder, allowed, workspace],
  );

  return { churn, fileLog, dialog };
}

/** "Colour by: Kind | Hotspots", and "Over the last 90 days" once Hotspots were asked for. */
export function HotTools() {
  const { key, mode, span, status, hot } = useHotspots();
  const src = useGitSource();
  const loading = status.kind === "loading";
  const wantsHot = hot || loading;
  return (
    <span className="hot-tools" role="group" aria-label="Colour the map by">
      <span className="note">Colour by</span>
      <button type="button" className={`ctl compact${!wantsHot ? " on" : ""}`} aria-pressed={!wantsHot} onClick={() => showKind(key)} title="Each card in its lane's colour">
        Kind
      </button>
      <button type="button" className={`ctl compact${wantsHot ? " on" : ""}`} aria-pressed={wantsHot} onClick={() => void showHot(key, span, src.churn)} title="Code that changes often and is large: from the project's git history">
        Hotspots
      </button>
      {(wantsHot || status.kind === "none" || mode === "hot") && (
        <label className="note hot-span">
          Over
          <select className="field" value={span} onChange={(e) => void showHot(key, e.target.value as Span, src.churn)} aria-label="Over which span of time">
            {SPANS.map((s) => (
              <option key={s} value={s}>
                {SPAN_WORDS[s]}
              </option>
            ))}
          </select>
        </label>
      )}
      {src.dialog}
    </span>
  );
}

/** In place of the arrows' legend: the heat ramp, the history being read, or why there are no hotspots.
 * Undefined when the arrows' own legend should show. */
export function useHotLegend(): React.ReactNode | undefined {
  const { status, hot, heat } = useHotspots();
  if (status.kind === "loading")
    return (
      <div className="legend" role="status">
        Reading the project’s history…
      </div>
    );
  if (status.kind === "none")
    return (
      <div className="legend hot-none" role="status">
        {status.why}
      </div>
    );
  if (!hot || !heat) return undefined;
  return (
    <div className="legend hot-legend">
      <span>cool</span>
      <span className="ramp" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`heat-${l}`} />
        ))}
      </span>
      <span>hot · changed often × large</span>
      {heat.capped && <span className="hot-capped">· the newest {heat.commits} commits</span>}
    </div>
  );
}

/** Details while the map is coloured by Hotspots: the hottest files, the selected card's note, a tour
 * of them, and "Why is it hot?". */
export function HotspotsDetails() {
  const s = useShell();
  const { heat, hot, span } = useHotspots();
  const src = useGitSource();
  const ai = pillState(useAiStatus());
  const [note, setNote] = useState<{ text: string; setup?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!hot || !heat) return null;

  const sel = s.selected ? heat.cards.get(s.selected) : undefined;
  const n = s.selected ? nodeById(s.map, s.selected) : undefined;
  const selFile = sel && sel.changes > 0 && sel.files.length === 1 ? sel.files[0] : null;
  const whyPath = selFile ?? heat.top[0]?.path ?? null;
  const tests = selFile ? testsImporting(s.map, s.repoView.files, selFile) : null;

  const tour = () => {
    const t = hotTour(s.map, heat);
    if (!t) return;
    s.setTour(t);
    s.setStep(0);
    s.shell.reveal("guide", "tour");
  };
  const why = async () => {
    if (!whyPath) return;
    // The app's own model answers there; with none set up, say so here rather than ask.
    if (TARGET === "full" && ai.kind === "setup") return setNote({ text: "No AI is set up yet, so there is nobody to ask why. Set one up, then ask again.", setup: true });
    setNote(null);
    setBusy(true);
    const commits = await src.fileLog(whyPath);
    setBusy(false);
    s.askWhyHot(whyPath, commits ? whyHotContext(whyPath, span, commits, Date.now()) : `(The commits that changed ${whyPath} couldn't be read.)`);
  };

  return (
    <section className="inspect hotspots" aria-label="Hotspots">
      <div className="label">Hotspots · {SPAN_SHORT[span]}</div>
      <p className="note">Code that changes often and is large breaks most. Start reviews and tests here.</p>
      <ol className="hot-list">
        {heat.top.map((f, i) => (
          <li key={f.path}>
            <button type="button" className={`hot-row${s.selected === f.card ? " on" : ""}`} onClick={() => s.jumpTo(f.card)} title={`${f.path}: ${f.changes} changes × ${f.lines} lines, by ${f.authors} ${f.authors === 1 ? "person" : "people"}`}>
              <span className="rank">{i + 1}</span>
              <span className="mono path">{f.path}</span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${Math.max(4, Math.round(f.share * 100))}%` }} />
              </span>
              <span className="num">
                {f.changes} × {f.lines}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {sel && sel.changes > 0 && n && (
        <div className="hot-note">
          <div className="label mono">{n.file ?? n.name}</div>
          {hotNote(sel, heat, tests)}
        </div>
      )}
      <div className="row">
        <button type="button" className="ctl compact" onClick={tour} disabled={!heat.top.length}>
          Tour the hotspots
        </button>
        <button type="button" className="ctl compact" onClick={() => void why()} disabled={!whyPath || busy} title={whyPath ? `Ask the guide why ${whyPath} changes so often` : undefined}>
          {busy ? "Reading its commits…" : "Why is it hot?"}
        </button>
      </div>
      {note && (
        <p className="note" role="status">
          {note.text}{" "}
          {note.setup && (
            <button type="button" className="link" onClick={openSetup}>
              Set up AI
            </button>
          )}
        </p>
      )}
    </section>
  );
}
