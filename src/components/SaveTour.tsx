"use client";
// "Save this tour" (docs/VOICE.md §6): the tour on screen as a file to share. A teammate opens
// it in the Guide on the same code and the tour plays, map and code moving with it; or the same
// steps as a Markdown document. It names each step with its file:line, and says what goes in:
// the narration (read aloud on replay, or the maker's own voice, recorded here a step at a time
// where the app can use the microphone), the lines each step shows (never whole files), and,
// when asked, the step's map cards by name. Keys, .env files and anything WalkMyCode hides never
// go in (src/lib/walkTour.ts). Loaded only when it opens.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import Sheet from "@/components/Sheet";
import type { RepoView, Tour } from "@/lib/claude/tools";
import { nodeAt, nodeById } from "@/lib/store";
import { buildWalkTour, excerptOf, hiddenFromTours, stepTitle, tourFileName, walkTourMarkdown, walkTourText, type Clip } from "@/lib/walkTour";
import { offerDownload } from "@/lib/fileSource";
import { canRecord, clipUrl, recordStep, type StepRecording } from "@/lib/voice/clip";
import { unlockAudio } from "@/lib/voice/view";
import { toast } from "@/shell/Toast";

interface Props {
  tour: Tour;
  repo: RepoView;
  /** The project's name, kept in the file for the "made on another project" message. */
  project?: string;
  /** The app can use the microphone (it has Talk); WalkMyCode Lite can't. */
  microphone: boolean;
  onClose: () => void;
}

type Recorded = Clip & { ms: number };

const time = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function SaveTour({ tour, repo, project, microphone, onClose }: Props) {
  const titleId = useId();
  const [name, setName] = useState(tour.title);
  const [lines, setLines] = useState(true);
  const [cards, setCards] = useState(false);
  const [kind, setKind] = useState<"tour" | "markdown">("tour");
  const mic = useMemo(() => microphone && canRecord(), [microphone]);
  const [voice, setVoice] = useState(false);
  const [clips, setClips] = useState<(Recorded | null)[]>(() => tour.steps.map(() => null));
  const [recording, setRecording] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const rec = useRef<StepRecording | null>(null);
  const playing = useRef<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      rec.current?.cancel();
      playing.current?.pause();
    },
    [],
  );

  // Steps in files WalkMyCode hides never go in; the rest, with what each shows.
  const { steps, kept, shown } = useMemo(() => {
    const steps = tour.steps.map((s, i) => ({ s, i, hidden: hiddenFromTours(s.file) }));
    const kept = steps.filter((x) => !x.hidden);
    let n = 0;
    const files = new Set<string>();
    for (const { s } of kept) {
      const ex = excerptOf(s.file, repo.files[s.file] ?? "", s.start_line, s.end_line);
      if (ex) {
        n += ex.split("\n").length;
        files.add(s.file);
      }
    }
    return { steps, kept, shown: { lines: n, files: files.size } };
  }, [tour, repo.files]);
  const recorded = clips.filter(Boolean).length;
  const voiced = voice && recorded > 0;

  const startRecording = async (i: number) => {
    setProblem(null);
    playing.current?.pause();
    try {
      rec.current = await recordStep();
      setRecording(i);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const stopRecording = async () => {
    const r = rec.current;
    const i = recording;
    rec.current = null;
    setRecording(null);
    if (!r || i === null) return;
    try {
      const got = await r.stop();
      if (!got) return setProblem("Nothing was heard. Check the microphone and record that step again.");
      setClips((c) => c.map((x, k) => (k === i ? got : x)));
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const play = (c: Clip) => {
    unlockAudio();
    playing.current?.pause();
    const url = clipUrl(c);
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    playing.current = a;
    void a.play().catch(() => setProblem("The browser held the sound back. Press play again."));
  };

  const save = async () => {
    const built = buildWalkTour(tour, repo.files, {
      name,
      created: new Date().toISOString(),
      project,
      lines,
      cards: cards
        ? (s) => {
            const ids = new Set(s.node_ids.filter((id) => nodeById(repo.map, id)));
            const owner = nodeAt(repo.map, s.file, s.start_line);
            if (owner) ids.add(owner.id);
            return [...ids].map((id) => ({ id, name: nodeById(repo.map, id)?.name ?? "" }));
          }
        : undefined,
      clips: voice && kind === "tour" ? clips : undefined,
    });
    if (!built.tour.steps.length) return setProblem("Every step of this tour is in a file WalkMyCode keeps hidden, so there is nothing to save.");
    const file = tourFileName(built.tour.name, kind);
    const r = kind === "tour" ? await offerDownload(file, walkTourText(built.tour), "application/json") : await offerDownload(file, walkTourMarkdown(built.tour), "text/markdown");
    if (r.kind === "denied") return setProblem(r.why ?? "The file could not be saved.");
    const notes = [r.why ?? `Saved ${file}.`];
    if (built.left.length) notes.push(`Left out ${plural(built.left.length, "step")} in files WalkMyCode hides.`);
    if (built.clipsLeft) notes.push(`${plural(built.clipsLeft, "recording")} were too long to keep; those steps are read aloud.`);
    toast(notes.join(" "));
    onClose();
  };

  return (
    <Sheet labelledBy={titleId} onClose={onClose} className="save-tour">
      <header className="st-head">
        <h2 id={titleId} className="st-label">
          Save this tour
        </h2>
        <span className="st-sum">
          {plural(kept.length, "step")} · {plural(shown.lines, "line")} · {voiced ? (recorded === kept.length ? "your voice" : `your voice on ${recorded} of ${kept.length}`) : "read aloud"}
        </span>
      </header>
      <div className="st-body">
        <div className="st-left">
          <label htmlFor={`${titleId}-name`} className="st-dim">
            Name
          </label>
          <input id={`${titleId}-name`} className="st-name" type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-autofocus />
          <ol className="st-steps">
            {steps.map(({ s, i, hidden }) => {
              const c = clips[i];
              return (
                <li key={i} className={`st-step${hidden ? " hidden" : ""}${recording === i ? " rec" : ""}`}>
                  <span className="st-n">{voice && c ? time(c.ms) : i + 1}</span>
                  <div className="st-what">
                    <strong>{stepTitle(s.say, s.file)}</strong>{" "}
                    <span className="st-where">
                      {s.file.split("/").pop()}:{s.start_line}
                    </span>
                    {hidden && <div className="st-dim">Left out: WalkMyCode never shares this file.</div>}
                    {voice && !hidden && (
                      <div className="st-rec">
                        {recording === i ? (
                          <button type="button" className="ctl compact on" onClick={() => void stopRecording()}>
                            ■ Stop recording
                          </button>
                        ) : (
                          <>
                            {c && (
                              <button type="button" className="ctl compact" onClick={() => play(c)} aria-label={`Play step ${i + 1}'s recording`}>
                                ▶ {time(c.ms)}
                              </button>
                            )}
                            <button type="button" className="ctl compact" onClick={() => void startRecording(i)} disabled={recording !== null}>
                              {c ? `Re-record step ${i + 1}` : `● Record step ${i + 1}`}
                            </button>
                            {!c && <span className="st-dim">read aloud until recorded</span>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="st-right">
          <p className="st-label">What goes in it</p>
          <div className="st-opt">
            <span className="st-tick" aria-hidden>
              ✓
            </span>
            <div>
              <strong>The narration</strong>
              <div className="st-dim">Each step&apos;s words, read aloud when the tour plays.</div>
            </div>
          </div>
          {mic && kind === "tour" && (
            <div className="st-opt">
              <input id={`${titleId}-voice`} type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={recording !== null} />
              <label htmlFor={`${titleId}-voice`}>
                <strong>Record my voice for each step</strong>
                <div className="st-dim">{voice ? `${recorded} of ${kept.length} recorded. A step you don't record is read aloud.` : "Your own voice, one short recording per step, played in place of the reading."}</div>
              </label>
            </div>
          )}
          <div className="st-opt">
            <input id={`${titleId}-lines`} type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
            <label htmlFor={`${titleId}-lines`}>
              <strong>The lines each step shows</strong>
              <div className="st-dim">
                {plural(shown.lines, "line")} from {plural(shown.files, "file")}. Nothing else from the project.
              </div>
            </label>
          </div>
          <div className="st-opt">
            <input id={`${titleId}-cards`} type="checkbox" checked={cards} onChange={(e) => setCards(e.target.checked)} />
            <label htmlFor={`${titleId}-cards`}>
              <strong>The map around them</strong>
              <div className="st-dim">The names of each step&apos;s cards, no code.</div>
            </label>
          </div>
          <p className="st-label">Share as</p>
          <div className="st-seg" role="radiogroup" aria-label="Share as">
            <button type="button" role="radio" aria-checked={kind === "tour"} className={kind === "tour" ? "on" : ""} onClick={() => setKind("tour")}>
              Tour file
            </button>
            <button type="button" role="radio" aria-checked={kind === "markdown"} className={kind === "markdown" ? "on" : ""} onClick={() => setKind("markdown")}>
              Steps in Markdown
            </button>
          </div>
          <div className="st-dim">
            {kind === "tour" ? (
              <>
                A <span className="st-mono">.walktour</span> file opens in WalkMyCode on the same code, and the map and code move as it plays. If the code has changed since, each step says so.
              </>
            ) : (
              "A document to read anywhere: a heading per step, its file and line, the lines it shows and what it says."
            )}
          </div>
          <div className="st-safe">
            Keys, <span className="st-mono">.env</span> files and anything WalkMyCode hides are never included.
          </div>
          {problem && (
            <p className="st-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="st-actions">
            <button type="button" className="ctl" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="ctl primary" onClick={() => void save()} disabled={recording !== null || !name.trim()}>
              {kind === "tour" ? "Save tour file" : "Save Markdown"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
