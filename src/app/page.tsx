"use client";
// Home (docs/design/home-redesign.html, screen 1): one door to a map. Drop a
// project folder, choose one, or put several together (a web app and its API)
// into one workspace; every folder stays on this machine, and with several, every
// path starts with its folder's name (docs/SERVICES.md §6). Below the door, the
// maps to pick up: the workspace kept in this browser and the repos indexed on
// the command line (`npm run index`), each with its lanes in small; then the
// examples: the example app every build carries ("Try with an example app", examples/
// team-tasks, packed by scripts/pack-example.mjs and mapped here like any folder, with a
// starter tour), then the indexed ones, when there are any. No forms: who answers is set up the first time it
// is needed (the top bar's AI pill, src/components/SetupAI.tsx) and lives in
// Settings. Mapping the same folders again keeps what the user told WalkMyCode about
// settings with no value ("Where does this point?", §13). In WalkMyCode Lite (inside
// Claude) folders come from a file input or a drop, there are no indexed repos,
// and the viewer's own Claude answers (src/lib/adapters/).
// Nothing heavy loads up front: the folder reader, the workspace store, the
// analyzer and the sheets are fetched when they are needed.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { Assertion, SourceFile } from "@/analyzer/types";
import { assetUrl } from "@/analyzer/assets";
import type { Tour } from "@/lib/claude/tools";
import { useGo } from "@/lib/adapters/nav";
import dynamicImport from "next/dynamic";
// "Start a new project" (src/ide/localrun/setup): its sheet and motion load only here, in the browser.
const NewProjectButton = dynamicImport(() => import("@/ide/localrun/setup/NewProjectButton"), { ssr: false });
import { pickSettings, pickSource } from "@/lib/adapters/select";
import { TARGET } from "@/lib/adapters/target";
import { carriesFiles, takeDrop, type Dropped } from "@/lib/dropped";
import type { PickedFolder } from "@/lib/localFolder";
import { cardOf, isExample, type MapCard } from "@/lib/mapCard";
import { motionOff } from "@/lib/motion";
import { hashFor, paneFromHash, type PaneId } from "@/lib/settingsNav";
import type { RepoSource, Workspace } from "@/lib/store";
import { combineRepos, defaultName, MAX_FILES_PER_REPO, splitRepos, tooMany } from "@/lib/workspace";
import TopBar from "@/components/TopBar";
import DropZone from "@/components/home/DropZone";
import { Examples, PickUp } from "@/components/home/MapCards";
import type { CardView, RepoRow } from "@/components/home/types";
import { readPref } from "@/lib/prefs";
import { prefStore, showDropTip, showFolderPrompt, turnFolderPromptOff } from "@/lib/folderPrompt";

const folders = () => import("@/lib/localFolder");
const workspaces = () => import("@/lib/store");
const PrivacySheet = dynamic(() => import("@/components/home/PrivacySheet"), { ssr: false });
const FolderPromptSheet = dynamic(() => import("@/components/home/FolderPromptSheet"), { ssr: false });
const SettingsPage = dynamic(() => import("@/components/home/SettingsPage"), { ssr: false });

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

// canPickFolders never changes during a visit, so there is nothing to subscribe to.
const noSubscribe = () => () => {};
const canPick = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
// What this build offers: Lite has no folder picker, indexed repos, keys or provider list.
const { indexed: INDEXED, drop: DROP } = pickSource({ target: TARGET, directoryPicker: false });
const SETTINGS = pickSettings(TARGET);
/** The example app: every build but WalkMyCode for Claude's page, which picks no folders. */
const EXAMPLE = TARGET !== "mcp" ? { file: "examples/team-tasks.json", key: "example:team-tasks" } : null;
/** The packed example (scripts/pack-example.mjs). */
interface ExampleApp {
  v: 1;
  name: string;
  title: string;
  about: string;
  files: SourceFile[];
  tour?: Tour;
}

/** When this browser last opened each card ("ws:<id>", "map:<name>"), kept in this browser only. */
const OPENED = "walkmycode.opened";
function readOpened(): Record<string, string> {
  try {
    const v = JSON.parse(readPref(window.localStorage, OPENED) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function markOpened(key: string) {
  try {
    const all = { ...readOpened(), [key]: new Date().toISOString() };
    const recent = Object.entries(all).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 50);
    window.localStorage.setItem(OPENED, JSON.stringify(Object.fromEntries(recent)));
  } catch {
    /* not remembered; the card says when it was mapped instead */
  }
}

function rowOf(p: PickedFolder): RepoRow {
  return { label: p.name, kind: "local", files: p.files, ...(p.handle ? { handle: p.handle } : {}), capped: p.capped };
}

type Problem = { where: "drop" | "cards"; text: string };

export default function Home() {
  const go = useGo();
  // Decided on the client after hydration; the server render assumes it can.
  const picker = useSyncExternalStore(noSubscribe, canPick, () => true);
  const plan = pickSource({ target: TARGET, directoryPicker: picker });
  const [indexed, setIndexed] = useState<MapCard[]>([]);
  const [saved, setSaved] = useState<Workspace | null>(null);
  const [opened] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : readOpened()));
  const [mode, setMode] = useState<"door" | "several">("door");
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<Problem | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  // What the user told WalkMyCode about settings with no value, and the folders it was said about:
  // mapping any of those folders again keeps it; a list of new folders starts afresh.
  const [answers, setAnswers] = useState<{ labels: string[]; assertions: Assertion[] }>({ labels: [], assertions: [] });
  const [sheet, setSheet] = useState<"privacy" | "folder" | null>(null);
  // Settings, full screen under the top bar; its pane lives in the URL hash (#settings/voice).
  const [settings, setSettings] = useState<PaneId | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** What the file input's folder is for: map it at once, or join the workspace being put together. */
  const inputFor = useRef<"map" | "add">("map");

  useEffect(() => {
    let live = true;
    if (INDEXED)
      fetch("/api/demo")
        .then((r) => r.json())
        .then((d: { cards?: MapCard[] }) => live && setIndexed(d.cards ?? []))
        .catch(() => {});
    // The workspace kept in this browser: its card, and the answers it was mapped with.
    workspaces()
      .then(async (s) => {
        const w = await s.restoreWorkspace();
        if (!live || !w) return;
        setSaved(w);
        setAnswers({ labels: w.repos.map((r) => r.label), assertions: w.assertions ?? s.answersOf(w.map) });
      })
      .catch(() => {});
    // The folder reader, once the page is idle, so "Choose a folder" opens the picker at once.
    const warm = () => void folders().catch(() => {});
    const idle = window.requestIdleCallback ? window.requestIdleCallback(warm, { timeout: 3000 }) : window.setTimeout(warm, 1500);
    return () => {
      live = false;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  /** Open Settings at a pane, or close it (null); the hash follows, without a new history entry. */
  function showSettings(pane: PaneId | null) {
    setSettings(pane);
    const url = window.location.pathname + window.location.search + (pane ? hashFor(pane) : "");
    window.history.replaceState(window.history.state, "", url);
  }
  // A link or a reload with #settings/<pane> opens it there; the hash edited by hand follows.
  useEffect(() => {
    const read = () => setSettings(paneFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const total = repos.reduce((s, r) => s + r.files.length, 0);

  /** Folders join the workspace being put together, each checked against the room the ones before it leave. */
  function addRows(rows: RepoRow[]) {
    let room = total;
    const ok: RepoRow[] = [];
    let why: string | null = null;
    for (const r of rows) {
      why = tooMany(room, r.files.length);
      if (why) break;
      room += r.files.length;
      ok.push(r);
    }
    const capped = ok.find((r) => r.capped);
    setErr(
      why
        ? { where: "drop", text: why }
        : capped
          ? { where: "drop", text: `${capped.label} has more than ${plural(MAX_FILES_PER_REPO, "file")} WalkMyCode reads; only the first ${plural(MAX_FILES_PER_REPO, "file")} are in.` }
          : null,
    );
    if (ok.length) setRepos((rs) => [...rs, ...ok]);
  }

  async function mapRepos(rows: RepoRow[], wsName?: string, starterTour?: Tour) {
    const count = rows.reduce((s, r) => s + r.files.length, 0);
    const why = tooMany(0, count);
    if (why) return setErr({ where: "drop", text: why });
    const labels = rows.map((r) => r.label);
    // The name box only shows for several folders; one folder is named after itself.
    const named = (rows.length > 1 && wsName?.trim()) || defaultName(labels);
    setErr(null);
    setProgress(0);
    setBusy(rows.length === 1 && rows[0].capped ? `${rows[0].label} is big: reading its first ${plural(MAX_FILES_PER_REPO, "file")}…` : `Reading ${plural(count, "file")}…`);
    const assertions = rows.some((r) => answers.labels.includes(r.label)) ? answers.assertions : [];
    try {
      const { sources, repos: refs } = combineRepos(rows.map((r) => ({ label: r.label, files: r.files, kind: r.kind })));
      // Parsed in a Web Worker, so the page keeps answering while it maps. Config
      // files come back with their secrets hidden, so the Code panel and the AI never see them.
      const [{ buildInWorker }, s] = await Promise.all([import("@/analyzer/buildInWorker"), workspaces()]);
      const { map, contents } = await buildInWorker({ sources, name: named, repos: refs, assertions }, (done, all, file) => {
        setProgress(all ? done / all : 0);
        setBusy(`Mapping ${file}`);
      });
      const now = new Date().toISOString();
      const list: RepoSource[] = rows.map((r, i) => ({ label: refs[i].label, kind: r.kind, fileCount: r.files.length, addedAt: now, ...(r.handle ? { handle: r.handle } : {}) }));
      const ws = s.newWorkspace(named, list, map, contents, assertions);
      s.setWorkspace(starterTour ? { ...ws, starterTour } : ws);
      markOpened(`ws:${ws.id}`);
      go("/map");
    } catch (e) {
      setErr({ where: "drop", text: (e as Error).message });
      setBusy(null);
      setOpening(null);
    }
  }

  /** "Try with an example app": the packed example, mapped here like a folder, with its starter tour. */
  async function openExample() {
    if (!EXAMPLE || busy || opening) return;
    setOpening(EXAMPLE.key);
    setErr(null);
    try {
      const r = await fetch(assetUrl(EXAMPLE.file));
      if (!r.ok) throw new Error(`the example could not be loaded (${r.status}).`);
      const ex = (await r.json()) as ExampleApp;
      await mapRepos([{ label: ex.name, kind: "demo", files: ex.files }], undefined, ex.tour);
    } catch (e) {
      setErr({ where: "drop", text: `Sorry, ${(e as Error).message}` });
      setOpening(null);
    }
  }

  /** "Choose a folder" maps the one folder at once; "Add a folder" adds it to the workspace. */
  async function chooseFolder(into: "map" | "add") {
    if (busy) return;
    if (plan.picker === "input") {
      inputFor.current = into;
      // The browser asks its own "Upload all files?" next: say what it means first (src/lib/folderPrompt.ts).
      if (showFolderPrompt(plan.picker, prefStore())) setSheet("folder");
      else fileInput.current?.click();
      return;
    }
    const picked = await (await folders()).pickFolder();
    if (!picked) return;
    if (into === "map") void mapRepos([rowOf(picked)]);
    else addRows([rowOf(picked)]);
  }

  /** Folders dropped anywhere on the page: one is mapped at once, several (or any while a
   * workspace is being put together) join it. */
  async function dropped(d: Dropped) {
    if (busy || opening || sheet || settings) return;
    setErr(null);
    setBusy("Reading the dropped folder…");
    setProgress(0);
    let picked: PickedFolder[];
    try {
      const lf = await folders();
      picked = (await lf.foldersFromHandles(d.handles)) ?? (await lf.foldersFromEntries(d.entries));
    } catch (e) {
      setBusy(null);
      setErr({ where: "drop", text: `That folder could not be read: ${(e as Error).message}` });
      return;
    }
    setBusy(null);
    if (!picked.length) return setErr({ where: "drop", text: "Drop a folder, not single files: WalkMyCode maps a whole folder." });
    const rows = picked.map(rowOf);
    if (mode === "door" && rows.length === 1) return void mapRepos(rows);
    setMode("several");
    addRows(rows);
  }
  // The window's listeners call the drop handler of the latest render.
  const onDrop = useRef(dropped);
  useEffect(() => {
    onDrop.current = dropped;
  });

  // A drag with files anywhere on the page lights the door; a drop anywhere is taken.
  useEffect(() => {
    if (!DROP) return;
    let off = 0;
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setOver(true);
      window.clearTimeout(off);
      off = window.setTimeout(() => setOver(false), 160);
    };
    const onDropEvent = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer) || !e.dataTransfer) return;
      e.preventDefault();
      window.clearTimeout(off);
      setOver(false);
      // Taken now: the browser lets go of the dropped items once the event is over.
      void onDrop.current(takeDrop(e.dataTransfer));
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDropEvent);
    return () => {
      window.clearTimeout(off);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDropEvent);
    };
  }, []);

  async function refresh(i: number) {
    const r = repos[i];
    if (!r.handle) return;
    setBusy(`Reading ${r.label} again…`);
    const again = await (await folders()).rereadFolder(r.handle);
    setBusy(null);
    if (!again) return setErr({ where: "drop", text: `The browser did not let me read ${r.label} again. Remove it and add the folder once more.` });
    const why = tooMany(total - r.files.length, again.files.length);
    if (why) return setErr({ where: "drop", text: why });
    setRepos((rs) => rs.map((x, j) => (j === i ? { ...rowOf(again), label: x.label } : x)));
  }

  async function addIndexed(n: string) {
    setBusy(`Fetching ${n}…`);
    try {
      const r = await fetch(`/api/demo?name=${encodeURIComponent(n)}`);
      const { files } = (await r.json()) as { files?: Record<string, string> };
      if (!files) throw new Error(`${n} could not be read from .walkmycode/.`);
      addRows([{ label: n, kind: "demo", files: Object.entries(files).map(([path, content]) => ({ path, content })) }]);
    } catch (e) {
      setErr({ where: "drop", text: (e as Error).message });
    }
    setBusy(null);
  }

  async function openIndexed(n: string) {
    if (opening || busy) return;
    const key = `map:${n}`;
    setOpening(key);
    setErr(null);
    try {
      const [r, s] = await Promise.all([fetch(`/api/demo?name=${encodeURIComponent(n)}`), workspaces()]);
      const d = (await r.json()) as { map?: Workspace["map"]; files?: Record<string, string> };
      if (!d.map || !d.files) throw new Error(`${n} could not be read from .walkmycode/.`);
      s.setRepo({ map: d.map, files: d.files, source: { kind: "demo", label: n } });
      markOpened(key);
      go("/map");
    } catch (e) {
      setErr({ where: "cards", text: (e as Error).message });
      setOpening(null);
    }
  }

  function open(c: CardView) {
    if (c.kind === "indexed") return void openIndexed(c.card.name);
    // The kept workspace is still in memory: its map opens as it was.
    setOpening(c.key);
    markOpened(c.key);
    go("/map");
  }

  /** Back to the folders a kept workspace was made of, ready to change and map again. */
  function edit() {
    const w = saved;
    if (!w || busy) return;
    const parts = splitRepos(
      w.files,
      w.map.repos.length === w.repos.length ? w.map.repos : w.repos.map((r) => ({ label: r.label, prefix: w.repos.length > 1 ? `${r.label}/` : "" })),
    );
    setRepos(w.repos.map((r, i) => ({ label: r.label, kind: r.kind === "demo" ? "demo" : "local", files: parts[i]?.files ?? [], ...(r.handle ? { handle: r.handle } : {}) })));
    setName(w.repos.length > 1 ? w.name : "");
    setMode("several");
    setErr(null);
    document.getElementById("door")?.scrollIntoView({ behavior: motionOff() ? "auto" : "smooth", block: "center" });
  }

  const cards = useMemo<CardView[]>(() => {
    const out: CardView[] = [];
    // An indexed map opened here is also the kept workspace: it shows once, as the indexed map.
    const names = new Set(indexed.map((c) => c.name));
    const sameAsIndexed = saved && saved.repos.length === 1 && saved.repos[0].kind === "demo" && names.has(saved.repos[0].label);
    if (saved && !sameAsIndexed) {
      const key = `ws:${saved.id}`;
      out.push({ key, kind: "saved", card: cardOf(saved.map, saved.name), when: opened[key] ? { verb: "Opened", iso: opened[key] } : { verb: "Mapped", iso: saved.map.generatedAt }, editable: !saved.codeElsewhere });
    }
    for (const c of indexed) {
      if (isExample(c.name)) continue;
      const key = `map:${c.name}`;
      out.push({ key, kind: "indexed", card: c, when: opened[key] ? { verb: "Opened", iso: opened[key] } : { verb: "Indexed", iso: c.generatedAt }, editable: false });
    }
    return out.sort((a, b) => b.when.iso.localeCompare(a.when.iso));
  }, [saved, indexed, opened]);
  const examples = useMemo(() => indexed.filter((c) => isExample(c.name)), [indexed]);

  return (
    <>
      <TopBar ai={SETTINGS.providers ? { onSettings: () => (settings ? showSettings(null) : showSettings("ai")), settingsOpen: !!settings } : undefined} />
      <div className="home-scroll">
        <main className="home">
          <p className="home-eyebrow">Your code, explained</p>
          <h1 className="home-hero">
            Find your way around{" "}
            <span className="u">
              the code you generated
              <svg viewBox="0 0 400 22" preserveAspectRatio="none" aria-hidden>
                <path pathLength={1} d="M4 14 C 80 4, 160 20, 240 10 S 360 6, 396 12" />
              </svg>
            </span>
          </h1>
          <p className="home-sub">Open a project and see every page, route and table on one map. Follow a button all the way to the database, and ask anything in plain English.</p>
          <NewProjectButton />

          <DropZone
            mode={mode}
            over={over}
            lite={!SETTINGS.providers}
            busy={busy}
            progress={progress}
            repos={repos}
            name={name}
            indexed={INDEXED ? indexed.map((c) => c.name) : []}
            onName={setName}
            onChoose={() => void chooseFolder("map")}
            onSeveral={() => {
              setMode("several");
              setErr(null);
            }}
            onAdd={() => void chooseFolder("add")}
            onAddIndexed={(n) => void addIndexed(n)}
            onRefresh={(i) => void refresh(i)}
            onRemove={(i) => setRepos((rs) => rs.filter((_, j) => j !== i))}
            onMap={() => void mapRepos(repos, name)}
            onCancel={() => {
              setMode("door");
              setRepos([]);
              setName("");
              setErr(null);
            }}
            onHow={() => setSheet("privacy")}
            dropTip={showDropTip(plan)}
          />
          {err?.where === "drop" && (
            <p key={err.text} className="home-err" role="alert">
              {err.text}
            </p>
          )}

          <PickUp cards={cards} opening={opening} error={err?.where === "cards" ? err.text : null} onOpen={open} onEdit={edit} />
          {EXAMPLE && (
            <section className="home-sect" aria-labelledby="example-app-h">
              <div className="home-sect-h">
                <h3 id="example-app-h">Try with an example app</h3>
              </div>
              <div className="home-examples">
                <button type="button" className="ex example-app" style={{ ["--i" as string]: 0 }} onClick={() => void openExample()} disabled={!!opening || !!busy}>
                  <span className="ex-ic" aria-hidden>
                    T
                  </span>
                  <span className="ex-txt">
                    <b>Team Tasks</b>
                    <span>{opening === EXAMPLE.key ? "Opening…" : "A small web app: pages, an API and a database. With a starter tour."}</span>
                  </span>
                  <span className="ex-go" aria-hidden>
                    →
                  </span>
                </button>
              </div>
            </section>
          )}
          <Examples cards={examples} opening={opening} onOpen={(n) => void openIndexed(n)} />

          <footer className="home-foot">
            <span>Open source</span>
            <span className="sep" aria-hidden>
              ·
            </span>
            <span>{SETTINGS.providers ? "Keys stay on this computer" : "Your code stays in this browser"}</span>
            <span className="sep" aria-hidden>
              ·
            </span>
            <button type="button" onClick={() => showSettings("ai")}>
              Settings
            </button>
          </footer>

          <input
            ref={fileInput}
            type="file"
            hidden
            // @ts-expect-error non-standard but widely supported
            webkitdirectory=""
            multiple
            onChange={async (e) => {
              const list = e.target.files;
              if (!list?.length) return;
              const picked = await (await folders()).filesFromInputAsync(list);
              e.target.value = "";
              if (inputFor.current === "map") void mapRepos([rowOf(picked)]);
              else addRows([rowOf(picked)]);
            }}
          />
        </main>
      </div>
      {sheet === "privacy" && <PrivacySheet lite={!SETTINGS.providers} onClose={() => setSheet(null)} />}
      {sheet === "folder" && (
        <FolderPromptSheet
          canDrop={plan.drop}
          onChoose={(never) => {
            if (never) turnFolderPromptOff(prefStore());
            // Opened from this click, so the browser allows it.
            fileInput.current?.click();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {settings && <SettingsPage pane={settings} onPane={showSettings} onClose={() => showSettings(null)} closeHere={!SETTINGS.providers} />}
    </>
  );
}
