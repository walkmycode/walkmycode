"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSample, type Sample } from "@/learn/lib/claude";
import { ML_LESSON_1 } from "@/learn/lib/seed";
import { useNow } from "@/learn/lib/now";
import { newId, openStore, type Store } from "@/learn/lib/store";
import { DEFAULT_PROFILE, type Course, type Lesson, type Profile, type RoadmapModule } from "@/learn/lib/types";
import { cleanRoadmap, roadmapPrompt } from "@/learn/lib/professor";
import { sampleMessage } from "@/learn/lib/claude";
import { addNote, removeNote, type Note } from "@/learn/lib/notebook";
import { cardsFor, dueCards, mergeCards, review, type Card } from "@/learn/lib/recall";
import { mapHref, readTeach, type TeachRequest } from "@/learn/links";
import TopBar from "@/components/TopBar";
import CodePanel from "./CodePanel";
import FolderCourse from "./FolderCourse";
import Library from "./Library";
import NewLesson from "./NewLesson";
import Player, { boardsSeen } from "./Player";
import Recall from "./Recall";

type View =
  | { kind: "library" }
  | { kind: "lesson"; id: string }
  | { kind: "new"; course?: string; teach?: TeachRequest; module?: { stage: string; module: RoadmapModule } }
  | { kind: "code" }
  /** Every recall card that is due, from every course. */
  | { kind: "recall" }
  /** A course from a folder of lessons on this computer. */
  | { kind: "folder" };

const ROOM_START = `# The Code room: try anything in Python here. Ctrl+Enter runs it.
# "Run on: My laptop" gives you numpy, pandas, scikit-learn and plots.

fares = [8, 11, 14, 19, 25, 31]
print("average fare:", sum(fares) / len(fares))
`;

/** The lesson open now is in the address (?lesson=<id>), so a reload comes back to it. */
function rememberLesson(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("lesson", id);
    else url.searchParams.delete("lesson");
    for (const k of ["teach", "from", "snippet"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url);
  } catch {
    /* an address that cannot be rewritten: the lesson still opens from the library */
  }
}

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [notes, setNotes] = useState<Note[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [view, setViewState] = useState<View>({ kind: "library" });
  const [error, setError] = useState("");
  const now = useNow();
  const saveErr = useRef(false);
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setView = useCallback((v: View) => {
    setViewState(v);
    rememberLesson(v.kind === "lesson" ? v.id : null);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, smp] = await Promise.all([openStore(), getSample()]);
      if (!live) return;
      setSample(() => smp);
      try {
        let list = await s.listLessons();
        if (!list.length) {
          const now = Date.now();
          const first: Lesson = { ...ML_LESSON_1, id: newId(), createdAt: now, updatedAt: now, at: 0, seen: [0] };
          await s.saveLesson(first).catch(() => {});
          list = [first];
        }
        const [p, cs, nb, deck] = await Promise.all([
          s.getProfile(),
          s.listCourses().catch(() => [] as Course[]),
          s.loadExtra<{ notes: Note[] }>("notebook").catch(() => null),
          s.loadExtra<{ cards: Card[] }>("cards").catch(() => null),
        ]);
        if (!live) return;
        setCourses(cs);
        setLessons(list);
        setProfile(p);
        setNotes(Array.isArray(nb?.notes) ? nb.notes : []);
        const opened = new URLSearchParams(window.location.search).get("lesson");
        const reopened = list.find((l) => l.id === opened);
        const had = Array.isArray(deck?.cards) ? deck.cards : [];
        // The lesson that was open comes back; one from before recall cards gets its cards from its quiz.
        const fresh = reopened && !had.some((c) => c.lessonId === reopened.id) ? mergeCards(had, cardsFor(reopened, null, Date.now())) : had;
        if (fresh !== had) void s.saveExtra("cards", { cards: fresh }).catch(() => {});
        setCards(fresh);
        // Arrived from the Explore room's "Teach me this": start that lesson. Else the lesson that was open.
        const teach = readTeach(window.location.search);
        if (teach) setViewState({ kind: "new", teach });
        else if (reopened) setViewState({ kind: "lesson", id: reopened.id });
      } catch {
        setError("Your saved lessons could not be loaded. Reload the page to try again.");
      }
      setStore(s);
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(
    (next: Lesson) => {
      const l = { ...next, updatedAt: Date.now() };
      setLessons((all) => (all.some((x) => x.id === l.id) ? all.map((x) => (x.id === l.id ? l : x)) : [...all, l]));
      store?.saveLesson(l).catch(() => {
        if (!saveErr.current) setError("Your progress could not be saved. It stays on this page until you reload.");
        saveErr.current = true;
      });
    },
    [store],
  );

  const saveCourse = useCallback(
    (c: Course) => {
      setCourses((all) => [...all.filter((x) => x.id !== c.id), c]);
      store?.saveCourse(c).catch(() => setError("The roadmap could not be saved. It stays on this page until you reload."));
    },
    [store],
  );

  // The notebook and the deck: changed from what is on screen, then written to the store.
  const putNotes = (next: Note[]) => {
    if (next === notes) return;
    setNotes(next);
    store?.saveExtra("notebook", { notes: next }).catch(() => setError("Your notebook could not be saved. It stays on this page until you reload."));
  };
  const putCards = (next: Card[]) => {
    if (next === cards) return;
    setCards(next);
    store?.saveExtra("cards", { cards: next }).catch(() => setError("Your recall cards could not be saved. They stay on this page until you reload."));
  };

  /** Ask the professor for a course's road to mastery, and keep it. */
  const planRoadmap = useCallback(
    async (name: string, goal: string, level: string): Promise<Course> => {
      if (!sample) throw { code: "not_configured", message: "No AI" };
      const earlier = lessons.filter((l) => l.course === name);
      const raw = await sample.json(roadmapPrompt(name, goal, level, profile, earlier), { cache: false });
      const road = cleanRoadmap(raw);
      if (!road) throw { code: "invalid_json", message: "The roadmap came back in a form that could not be read." };
      const existing = courses.find((c) => c.name === name);
      const now = Date.now();
      const course: Course = { id: existing?.id ?? newId(), name, goal: road.goal, stages: road.stages, createdAt: existing?.createdAt ?? now, updatedAt: now };
      saveCourse(course);
      return course;
    },
    [sample, lessons, profile, courses, saveCourse],
  );

  const current = view.kind === "lesson" ? lessons.find((l) => l.id === view.id) : undefined;
  /** Open a lesson. One from before recall cards gets its cards from its quiz, the first time. */
  const openLesson = (l: Lesson) => {
    if (!cards.some((c) => c.lessonId === l.id)) putCards(mergeCards(cards, cardsFor(l, null, Date.now())));
    setView({ kind: "lesson", id: l.id });
  };

  if (!store) {
    return (
      <>
        <TopBar title="Learn" />
        <div className="learn">
          <div className="hall">
            <div className="frame"><section className="board loading"><h2>Opening the lecture hall…</h2></section></div>
          </div>
        </div>
      </>
    );
  }

  // Cards open once their lesson's boards have been seen: nobody is asked what they have not been taught.
  const taught = new Set(lessons.filter(boardsSeen).map((l) => l.id));
  const openCards = cards.filter((c) => taught.has(c.lessonId));
  const due = dueCards(openCards, now).length;
  const onReview = (card: Card, knew: boolean) => putCards(cards.map((c) => (c.id === card.id ? review(c, knew, Date.now()) : c)));

  const toLibrary = () => setView({ kind: "library" });
  const back = (
    <button className="ctl compact" type="button" onClick={toLibrary} title="Back to every course and lesson">
      ← All lessons
    </button>
  );
  const codeRoom = (
    <button className="ctl compact" type="button" onClick={() => setView({ kind: "code" })} title="Python in the browser, with the professor beside you">
      {"</>"} Code room
    </button>
  );

  // What is open, for the middle of the bar: the lesson, the course being added to, or the Code room.
  const detail =
    current ? `${current.course} · Lesson ${current.number} · ${current.title}`
    : view.kind === "code" ? "Code room"
    : view.kind === "recall" ? "Recall"
    : view.kind === "folder" ? "A course from a folder"
    : view.kind === "new" ? (view.course ? `A new lesson in ${view.course}` : "A new lesson")
    : undefined;

  return (
    <>
      <TopBar title="Learn" detail={detail}>
        {view.kind === "library" ? (
          <>
            {due > 0 && (
              <button className="ctl compact" type="button" onClick={() => setView({ kind: "recall" })} title="The ideas due to be remembered today">
                Recall · {due} due
              </button>
            )}
            {codeRoom}
            {store.kind === "computer" && (
              <button className="ctl compact" type="button" onClick={() => setView({ kind: "folder" })} title="Teach a course kept as a folder of lessons on this computer">
                Course from a folder
              </button>
            )}
            <button className="ctl compact primary" type="button" onClick={() => setView({ kind: "new" })}>
              New lesson
            </button>
          </>
        ) : (
          <>
            {back}
            {current?.source && (
              <a
                className="ctl compact"
                href={mapHref(current.source.file, { start: current.source.start, end: current.source.end })}
                title={`See it in your code: ${current.source.file}${current.source.start ? `:${current.source.start}` : ""}`}
              >
                See it in your code →
              </a>
            )}
          </>
        )}
      </TopBar>
      <div className="learn">
        {error && <p className="banner" role="alert">{error}</p>}
        {view.kind === "lesson" && current ? (
          <Player
            key={current.id}
            lesson={current}
            profile={profile}
            sample={sample}
            store={store}
            save={save}
            onNext={(l) => setView({ kind: "new", course: l.course })}
            notes={notes}
            onNote={(text, from, l) => putNotes(addNote(notes, { id: newId(), text, at: Date.now(), from, lessonId: l.id, lessonTitle: l.title, course: l.course }))}
            onDropNote={(id) => putNotes(removeNote(notes, id))}
            cards={cards}
            onReview={onReview}
          />
        ) : view.kind === "code" ? (
          <div className="hall room">
            <CodePanel
              code={profile.scratch ?? ROOM_START}
              starter={ROOM_START}
              onCode={(c) => {
                const p = { ...profile, scratch: c };
                setProfile(p);
                if (scratchTimer.current) clearTimeout(scratchTimer.current);
                scratchTimer.current = setTimeout(() => store.saveProfile(p).catch(() => {}), 1000);
              }}
              sample={sample}
              profile={profile}
            />
          </div>
        ) : view.kind === "recall" ? (
          <div className="hall recall-room">
            <div className="frame"><section className="board"><h2>Recall</h2><Recall cards={openCards} onReview={onReview} /></section></div>
          </div>
        ) : view.kind === "folder" ? (
          <FolderCourse
            courses={courses}
            onAdd={(c) => {
              saveCourse(c);
              toLibrary();
            }}
          />
        ) : view.kind === "new" ? (
          <NewLesson
            sample={sample}
            profile={profile}
            lessons={lessons}
            course={view.course}
            teach={view.teach}
            module={view.module}
            roadmap={courses.find((c) => c.name === view.course)}
            onRoadmap={saveCourse}
            planRoadmap={planRoadmap}
            onDone={(l, written) => {
              save(l);
              putCards(mergeCards(cards, cardsFor(l, written, Date.now())));
              setView({ kind: "lesson", id: l.id });
            }}
          />
        ) : (
          <Library
            lessons={lessons}
            profile={profile}
            canWrite
            store={store}
            due={due}
            onRecall={() => setView({ kind: "recall" })}
            onOpen={openLesson}
            onNew={(course) => setView({ kind: "new", course })}
            roadmaps={courses}
            onPlan={async (name) => {
              try {
                await planRoadmap(name, "", "Beginner");
              } catch (e) {
                setError(sampleMessage(e) || "The roadmap could not be planned. Try again.");
              }
            }}
            onStartModule={(course, stage, module) => setView({ kind: "new", course, module: { stage, module } })}
            onDelete={(l) => {
              setLessons((all) => all.filter((x) => x.id !== l.id));
              if (cards.some((c) => c.lessonId === l.id)) putCards(cards.filter((c) => c.lessonId !== l.id));
              store.deleteLesson(l.id).catch(() => setError("That lesson could not be deleted. Try again."));
            }}
            onProfile={(edit) => {
              const p = { ...profile, ...edit }; // keeps the Code room's scratchpad
              setProfile(p);
              store.saveProfile(p).catch(() => setError("Your profile could not be saved. Try again."));
            }}
          />
        )}
      </div>
    </>
  );
}
