"use client";
// One open file (panel id `code:<path>`): the shared editor, read-only, with
// its own selection bar (Explain this / Trace it). CodeMirror puts its styles
// into the document it was made in, so when the panel moves to a pop-out
// window the editor is re-rooted there (docs/SHELL.md §7). The editor itself
// is never remounted by a move, so scroll and selection survive.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { IDockviewPanelProps } from "dockview-react";
import type { Selection } from "@/ide/Editor";
import type { AskVia } from "@/ide/Ide";
import { MCP } from "@/lib/adapters/target";
import { MAX_TEXT } from "@/lib/bridge/protocol";
import { getSample, type Sample } from "@/learn/lib/claude";
import { DEFAULT_PROFILE } from "@/learn/lib/types";
import { saveFile } from "@/lib/fileSource";
import { getWorkspace, nodeAt, updateFileContent } from "@/lib/store";
import { toast } from "../Toast";
import { motionOff } from "@/lib/motion";
import { light } from "@/lib/light";
import { useShell } from "../WorkspaceProvider";
import { glideAfterJump } from "./codeScroll";
import AddFolder, { CODE_MISSING } from "@/components/AddFolder";
import { eolOf, toLF, withEol } from "./lineEndings";

// The shared IDE (CodeMirror, its runners and the Learn room's markup with KaTeX) loads
// with the first file opened, not with the map: the map paints and answers clicks first.
const Ide = dynamic(() => import("@/ide/Ide"), {
  ssr: false,
  loading: () => (
    <div className="fill" style={{ display: "grid", placeItems: "center" }}>
      <p className="note">Opening the code…</p>
    </div>
  ),
});

export default function CodePanel({ api, params }: IDockviewPanelProps<{ path: string }>) {
  const s = useShell();
  const path = params.path;
  const host = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const highlight = s.files.find((f) => f.path === path)?.highlight ?? null;
  const content = s.repo.files[path];
  // The editor holds lines, not line endings: it is given the file with "\n"
  // endings, so a "\r\n" file is not "changed" by being opened (./lineEndings.ts).
  const text = useMemo(() => (content === undefined ? undefined : toLF(content)), [content]);
  // The shared IDE: read-only until "Edit"; Save writes back through the file's source.
  const [draft, setDraft] = useState<string | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => {
    let live = true;
    // The AI is itself a function: wrapped, or React would call it as a state updater.
    void getSample().then((sm) => live && setSample(() => sm));
    return () => {
      live = false;
    };
  }, []);
  // WalkMyCode for Claude: "Explain this code" and questions here go to the user's own Claude,
  // as the guide's do (an explain or question request on the bridge, answered with Claude's
  // own tools; the page's own key if Claude isn't listening). That page's server has no
  // /api/learn, which the professor's `sample` would call.
  const askVia = useMemo<AskVia | undefined>(
    () =>
      MCP
        ? async ({ question, kind, selection: sel }, o) => {
            const { ask, emptyConversation } = await import("@/lib/claude/client");
            const lines = sel ? { from: sel.start, to: sel.end } : undefined;
            try {
              const r = await ask({
                repo: s.repoView,
                conversation: emptyConversation(),
                user: sel ? `${question}\n\n${path}:${sel.start}-${sel.end}` : `${question}\n\n${path}`,
                mode: "ask",
                request:
                  kind === "explain"
                    ? { kind: "explain", payload: { path, ...(sel ? { from: sel.start, to: sel.end, text: sel.text.slice(0, MAX_TEXT) } : {}) }, context: { file: path, ...(lines ? { lines } : {}) } }
                    : { kind: "question", payload: { text: question.slice(0, MAX_TEXT) }, context: { file: path, ...(lines ? { lines } : {}) } },
                onText: o.onText,
                signal: o.signal,
              });
              return r.text;
            } finally {
              // Claude may have opened another file over this one while it read (highlight_lines,
              // open_file): bring this panel back, so the answer (or error) isn't left in a hidden tab.
              if (!api.isVisible) api.setActive();
            }
          }
        : undefined,
    [s.repoView, path, api],
  );
  const shown = draft ?? text ?? "";
  const dirty = draft !== null && draft !== text;
  const onSave = async (edited: string) => {
    const ws = getWorkspace();
    if (!ws) return;
    // Back into the file with the line endings it had.
    const out = withEol(edited, eolOf(content ?? ""));
    const r = await saveFile(ws, path, out);
    if (r.kind === "denied") {
      toast(`Not saved: ${r.why}`);
      return;
    }
    updateFileContent(path, out);
    setDraft(null);
    toast(r.kind === "written" ? `Saved ${path.split("/").pop()}. Map it again to update the map.` : r.why);
  };
  const lang = useMemo(() => s.map.files.find((f) => f.path === path)?.lang ?? "", [s.map, path]);
  // Every open file is a mounted panel: its editor is drawn again only when its own file, draft or lines change.
  const editor = useMemo(
    () =>
      content !== undefined ? (
        <Ide
          path={path}
          value={shown}
          mode="read"
          frameless
          onChange={setDraft}
          onSave={(t) => void onSave(t)}
          dirty={dirty}
          starter={text}
          highlight={highlight}
          onSelect={setSelection}
          sample={sample}
          askVia={askVia}
          profile={DEFAULT_PROFILE}
          layout="stacked"
          wrap
          // Config and .proto files (compose, Dockerfile, k8s) are shown as plain text.
          language={lang === "config" || lang === "proto" ? "text" : undefined}
        />
      ) : (
        <div className="fill" style={{ display: "grid", placeItems: "center" }}>
          {getWorkspace()?.codeElsewhere ? (
            <div className="code-missing-file">
              <p className="note">{CODE_MISSING.file}</p>
              <AddFolder />
            </div>
          ) : (
            <p className="note">That file isn’t in the repo.</p>
          )}
        </div>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSave reads the latest workspace when called
    [path, content, text, shown, dirty, highlight, lang, sample],
  );

  // Re-root CodeMirror in whichever window now holds the panel.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const reroot = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const el = host.current?.querySelector<HTMLElement>(".cm-editor");
        if (!el) return;
        void import("@codemirror/view").then(({ EditorView }) => EditorView.findFromDOM(el)?.setRoot(el.ownerDocument));
      }, 50);
    };
    reroot();
    const d = api.onDidLocationChange(reroot);
    return () => {
      clearTimeout(t);
      d.dispose();
    };
  }, [api]);

  // A new highlight in this file: glide to it (docs/MOTION.md §4.4), then light
  // the line up once and bring the light to it. The layout effect notes where
  // the scroller was before the editor's own effect jumps; the effect below
  // runs after it.
  const litKey = highlight ? `${highlight[0]}-${highlight[1]}` : "";
  const scrollFrom = useRef<number | null>(null);
  useLayoutEffect(() => {
    scrollFrom.current = host.current?.querySelector<HTMLElement>(".cm-scroller")?.scrollTop ?? null;
  }, [litKey]);
  useEffect(() => {
    const el = host.current;
    const scroller = el?.querySelector<HTMLElement>(".cm-scroller");
    if (!el || !scroller || !litKey) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const cancel = glideAfterJump(scroller, scrollFrom.current, motionOff(), () => {
      // The ignite class lives on our own wrapper: CodeMirror owns .cm-editor's classes.
      el.classList.remove("ignite");
      void el.offsetWidth; // restart the keyframe on a second citation
      el.classList.add("ignite");
      t = setTimeout(() => el.classList.remove("ignite"), 600);
      // The light lands on the first lit line's bar (its beacon) and hands off to it;
      // in a hidden tab, or a window without a light, it just hides.
      const line = el.querySelector<HTMLElement>(".cm-line.cm-lit-line");
      if (line) light.settleOn(line, { at: "left", dx: 2, handoff: true });
    });
    return () => {
      cancel();
      clearTimeout(t);
    };
  }, [litKey]);

  // The tab the user is on is "the file they are looking at".
  const { setActivePath } = s.shell;
  useEffect(() => {
    const d = api.onDidActiveChange((e) => {
      if (e.isActive) setActivePath(path);
    });
    return () => d.dispose();
  }, [api, path, setActivePath]);

  return (
    <div className="dock-panel code" ref={host}>
      {editor}
      <div className="selbar">
        {selection ? (
          <>
            <span>
              lines {selection.start}
              {selection.end !== selection.start ? `–${selection.end}` : ""} selected
            </span>
            <button className="ctl compact primary" onClick={() => s.explainSelection(selection)}>
              Explain this
            </button>
            <button
              className="ctl compact"
              onClick={() => {
                const n = nodeAt(s.map, selection.path, selection.start);
                if (n) s.traceNode(n);
              }}
            >
              Trace it
            </button>
          </>
        ) : (
          <span className="note" title={path}>
            {path} · select some lines to explain them.
          </span>
        )}
      </div>
    </div>
  );
}
