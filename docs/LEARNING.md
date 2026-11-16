# How Learn teaches

Learn's teaching follows seven habits of Leonardo da Vinci, as told in Nic Munoz's video
[Leonardo's INSANE Learning Habits Will Blow Your Mind](https://www.youtube.com/watch?v=BtZHSt2amaU)
(26 minutes; it draws on Walter Isaacson's biography *Leonardo da Vinci*). The video's chapters are the
seven principles below, in its order. For each one: what the video says, and where it shows up in Learn.

The second source is the owner's own Rust course, whose lessons open with one big picture and give every
concept a child-simple `💡 Analogy`. Learn copies that shape.

| # | Principle (video chapter) | In one line | Where it lives in Learn |
|---|---|---|---|
| 1 | Art and science are one field | Everything connects to everything else | Diagrams and code on the same board; the course outline; "Connect it" |
| 2 | Use analogy | Carry a rule from a thing you know to a thing you don't | A 💡 analogy on every talk board; "Like I'm 10" |
| 3 | Sporadic journaling | One commonplace book for every thought, unsorted | The Notebook: one for all courses |
| 4 | Test knowledge | Experience first, then the reason | Run the example, exercises, tests, hints before answers, Recall cards |
| 5 | Learn from people | Seek out the master and ask a specific question | The professor's conversation, kept per lesson; courses taught from an author's own folder |
| 6 | Think different | Hit the target nobody else can see | "What if?" and "Connect it" push past the lesson's own example |
| 7 | Relentless curiosity | Keep asking the questions a ten-year-old asks | "Wonder next" questions under every answer |

## 1. Art and science are one field

**The video.** Leonardo did not split art, engineering and anatomy into subjects: "study the science of
art, study the art of science, learn how to see, realise that everything connects to everything else".
School divides learning into subjects and then into sub-subjects; a polymath removes the divides.

**In Learn.**
- A board can carry writing, a table, maths, a diagram and runnable code together: the picture and the
  rule are taught as one thing (`Board.lines[].diagram`, `Board.example`).
- The lesson outline and the course's road to mastery show a course as one journey, not separate files
  (`Outline` in `src/learn/components/Player.tsx`, `Roadmap.tsx`).
- The professor's **Connect it** action ties the current idea to an earlier lesson or to another field.
- The professor is told every earlier lesson of the course, so a new lesson builds on the old ones.

## 2. Use analogy

**The video.** Leonardo theorised by analogy: the branching of trees, arteries and rivers; water flow
and air lift. Analogy is how he crossed between fields.

**In Learn.**
- Every talk board has an `analogy`: one everyday picture a child would understand, shown in a 💡 block
  under the chalk lines. The lesson prompt asks for one big picture first and has later boards extend it,
  as the Rust course does (`lessonPrompt`, `folderLessonPrompt` in `src/learn/lib/professor.ts`).
- When a lesson is taught from a folder, the author's own `> 💡` analogies are used word for word.
- **Like I'm 10** asks the professor to explain the board again with a fresh analogy.
- **Watch it happen** turns a board's analogy into a scene to watch (mockup
  `docs/design/learn-analogy-visual.html`). A scene is data (`src/lib/scene/model.ts`): a few holders, a
  few things they hold, and at each step who holds what. The same data draws the everyday picture and the
  real thing, so they cannot disagree, and it is drawn two ways (`src/components/scene/SceneBlock.tsx`):
  - **the picture**: the everyday row directly above the real row, column for column, so what stands for
    what is a straight line down (Emily over `s1`). Holders and things are drawings. A thing glides to its
    new holder; what the step did is an arrow that draws itself, with a dot riding it, and then keeps
    flowing the way the thing went (a move, a drop into the toy box), or a dashed thread (a loan, with a
    copy marked "on loan"). Someone who checks the rules (the teacher, the compiler) watches, and stops
    the step that breaks one, beside the real error.
  - **a sequence diagram**: each holder a lifeline, each hand-over a message carrying the thing, every
    label in both languages ("gives away · `move`"). Derived from the same steps (`sceneEvents`).

  Beside it: the code a line at a time, and **the words**: every technical term the scene uses, with its
  drawing and a few plain words, stamped on the stage as it happens ("giving away is a move"); a word
  jumps to the step that teaches it. Under it: the rule in one line, and where the picture breaks. Play
  reads each step aloud. It takes the full width while it is open; **Side panels** brings the outline and
  the professor back. With motion off nothing moves and it is just as clear. The professor writes the
  scene the first time it is asked for (`scenePrompt` in `src/learn/lib/scene.ts`); it is then kept with
  the lesson. **My own picture** has it drawn again in a picture the student names ("a football team").
- **The drawings** (`src/lib/drawings`; every one on a page, `docs/design/drawings-gallery.html`, written by
  `npx tsx scripts/drawings-gallery.ts`): about 330 small flat pictures, so a lesson in any subject finds
  its things drawn: everyday things, people and the work they do (police, nurse, judge, developer,
  astronaut…), places, nature, the body and health, science and maths, history, government and the
  world, business, the home, the arts and sport, devices, software engineering (a terminal, a function,
  a linked list, a hash map, a git branch, a pull request, a CI pipeline…) and system design (a load
  balancer, an API gateway, a cache, a CDN, a message broker, a container, a cluster, DNS, a firewall, a
  VPN, a data centre…). Each is plain SVG shapes of under 1.5 KB, with no images, gradients or filters.
  They ship with the app and load the first time a scene is shown. Explore's Files panel wears them too
  (`src/lib/fileIcon.ts`, mockup `docs/design/files-icons.html`): each file the drawing for what it is (the
  Dockerfile the container, a workflow the CI conveyor, a test the checklist, a lock file the chain, `.env`
  the padlock), code in its language's colour, and a folder with a job that job's drawing. The tree shows
  each file's kind as before until the drawings have loaded, then swaps them in. The professor picks one by name; when it gives none, or a name the set
  does not have, the everyday label finds one (`findDrawing`: "the postman" is the van). One drawing
  serves many uses: a colour and a label make one box a toy box or a lunch box, and each person in a
  scene gets a different look, with a glad and a sad face. A model only ever names a drawing or a colour:
  nothing it writes is put on the page as markup.
- **A drawing of the professor's own.** For something the set has no drawing of (a kite, a windmill), the
  professor may draw it: `draw`, at most 14 plain shapes (circle, rect, ellipse, line, poly) on the same
  64 × 64 square, each with a colour by name. It is offered only as a last resort, after the drawings by
  name. `cleanShapes` keeps only numbers inside the square and known names, and the page makes one SVG
  element from each, so this too is never markup. A name the set has still wins over it.
- **A scene in any answer.** A fenced ```` ```scene ```` block of JSON in an answer is drawn the same way
  (`readSceneBlock`), in the professor's conversation, the Explore guide, and an AI app's answers through
  the MCP server (its `answer` tool takes a `scene`). Every model is told how to write one (`SCENE_BLOCK`),
  for when someone asks for an analogy, to have it explained simply, or for a sequence diagram a beginner
  can follow. A block that is not a valid scene is shown as it was written. Every such model is also given
  the drawings' names (`src/lib/drawings/names.ts`, the names alone, kept the same as the set by a test),
  so it picks each drawing itself; a label is only read for one when it names none, and then for the thing
  itself ("a child at the door" is a child, not a door). In an answer a scene is narrow: **Larger** draws
  it in the app's root so it fills the window, wherever the answer sits (`useFull.ts`); Esc puts it back.
- **A picture diagram**: a class, ER, state or flow diagram with its analogy drawn in
  (`src/lib/scene/diagram.ts`, `PictureDiagram.tsx`), from a fenced ```` ```picture ```` block (or the MCP
  `answer` tool's `picture`). Every box is an everyday thing, its drawing and everyday name over the real
  name it stands for, with what it holds (fields, methods, columns); every line says what it means in both
  languages, and is the next step, a use, owning (a diamond at the owner) or "is a kind of" (a hollow
  arrow, the general thing above). Boxes sit in rows worked out from the lines (`rowsOf`; a line that
  closes a loop is drawn but moves nothing). Pointing at a box lights its lines; Play walks the lines one
  by one, the two boxes lit and a dot riding the line, with the step said in the picture and for real.
  A line shows its everyday words; the real ones join them while it is the line being shown or pointed
  at, and lines that leave one box together say their words where they have parted, so a busy diagram
  stays readable. Lines pass behind the boxes; their words are written over them.
  A scene shows what happens over time; a picture diagram shows how things are joined. Every model is told
  how to write one (`PICTURE_BLOCK`), for a beginner who asks for such a diagram with an analogy.
- **A diagram's picture key.** A Mermaid diagram that backs an analogy names each box twice (the real name,
  then the analogy's word: `DIAGRAM_RULES`). Under any such diagram (class, state, flow, ER, sequence) the
  key shows each of those words with its drawing beside the real name (`src/lib/scene/key.ts`,
  `PictureKey.tsx`).
- `npm run e2e:scene` runs all of this in the real app in headless Chrome, with a stand-in professor.
- Every analogy is held to the same rules (`ANALOGY_RULES`): things a ten-year-old has touched, one
  idea, what stands for what, true to the code, honest about where it stops.
- A diagram backs the analogy where the concept has structure, flow or ownership (`DIAGRAM_RULES`):
  each box carries the real name and the analogy's word for it. A recall card can carry its diagram.
- The professor's answers mark an analogy with 💡, and the chat draws it as a callout.

## 3. Sporadic journaling

**The video.** Leonardo kept one notebook on his belt and wrote every idea, question and sketch in it,
with no division by subject: a commonplace book. Mixing fields on one page is what makes the
connections visible ("potatoes, pasta and vegetables are good alone; in a stew they become something
else").

**In Learn.**
- The **Notebook** tab is one notebook for every course and lesson. A thought is jotted in one line
  from any lesson; any answer from the professor is saved with one click (`src/learn/lib/notebook.ts`).
- Notes are kept newest first and unsorted on purpose; each remembers the lesson it came from.

## 4. Test knowledge

**The video.** "My intention is to consult experience first, and then with reasoning show why."
Leonardo ran the experiment himself instead of reading what others wrote about it.

**In Learn.**
- **Run it.** A board's example runs in the lesson's editor with one click, and the student changes it
  and runs it again.
- **Exercises with real checks.** A course folder's exercises become code boards. Rust exercises that
  carry tests run them with the toolchain on this computer; the professor marks the answer against the
  course's own solution file.
- **Hints before answers.** The hint ladder gives a nudge, then a pointer, then a near-answer. The
  solution opens only after three hints or a real attempt (`src/learn/lib/hints.ts`).
- **Recall.** Each lesson's key ideas become cards that come back after 1, 3, 7, 16 and 35 days; a
  missed card starts again (`src/learn/lib/recall.ts`).
- The quiz and the explain-back end every lesson, as before.

## 5. Learn from people

**The video.** Leonardo's to-do lists name people: "Get the master of arithmetic to show you how to
square a triangle." He went to whoever knew a thing best and asked a specific question.

**In Learn.**
- The professor is always beside the board. The conversation is kept per lesson on this computer, so a
  student picks it up where they stopped (`.walkmycode/learn/`).
- The empty conversation offers specific questions about the board on screen, not a blank box.
- The professor has a face (`ProfessorFace.tsx`, `src/learn/lib/face.ts`, design and reference frames in): a portrait beside the board and a small head by the panel's tabs. It
  is an original character in the manner of a call-centre headset figure: a softly shaded bust in a
  disc, round glasses, a bow tie, a white headset with a chalk-yellow microphone. While it speaks its
  mouth is blended from seven shapes by the voice that is playing: loudness opens the jaw, and where
  the sound's energy sits (low, middle, high) makes it rounder or wider. The sound is a measured copy
  of the app's audio; the browser's own voice cannot be measured and gets a speaking rhythm through
  the same shapes. It blinks and glances about when idle, looks up and aside while an answer is on its
  way, tilts its head while the student speaks a question, and smiles when an exercise is passed.
  With motion off each state is one still pose. Settings → Voice switches it off.
- A course can be taught from its author's own folder (lessons, examples, exercises, solutions): the
  author is the master, and the professor teaches their material in their order.

## 6. Think different

**The video.** Schopenhauer: talent hits a target nobody else can hit; genius hits a target nobody else
can see. Seeing fields as one is what shows the unseen target.

**In Learn.**
- **Connect it** and the "Wonder next" questions lead away from the lesson's worked example: what if
  the rule were different, where else does this shape appear.
- The explain-back asks for the student's own words, never the board's.

## 7. Relentless curiosity

**The video.** "Describe the tongue of a woodpecker." Leonardo stayed curious about what most people
stop noticing after the age of ten. The video's last advice is its main one: be more curious.

**In Learn.**
- Every answer from the professor ends with two or three **Wonder next** questions the student can
  click.
- No question is off topic: the professor answers it briefly and leads back to the lesson.

## A course from a folder

**`docs/COURSES.md` is the guide for authors**, for any subject: lessons as numbered Markdown files or
folders, exercises answered in words with model answers, and the starter course Learn can write.
The summary below is the code-course shape it grew from.

Learn can teach a course kept as a folder of lessons on this computer (**Course from a folder** in the
Learn room; the full app only). A lesson is a folder with a `README.md` and, beside it, any of:

| In the lesson folder | What Learn does with it |
|---|---|
| `README.md` | The lesson itself: its `##` sections become the boards, in order; each `> 💡` block is the board's analogy, in the author's words; `- [ ]` lines are what it covers |
| `examples/*` | One runnable idea per file: a board that teaches it gets **Run the example** |
| `exercises/*` | Code boards after the talk boards; the comment at the top of the file is the task |
| `solutions/*` | Paired with an exercise by number (`ex01_…` with `sol01_…`): the professor marks against it and chooses hints from it; the student sees it only after three hints or a real attempt |
| `src/main.*` | The lesson's small project, given to the professor to read |

Lesson folders are found up to four levels down and taught in folder order (`2_x` before `10_x`); the
folder above a lesson is its unit. Build folders, hidden files and `.env` files are never read. A lesson
whose README only lists its sections is still taught: the professor writes it in the course's style.

A lesson is first asked for whole. A provider that refuses it for size (a free plan's
tokens-per-minute limit, as on Groq) gets it in steps instead (`writeFolderLessonInSteps`): one small
request per part of the README, then one for the quiz, the explain-back and the cards, waiting and
trying again when the per-minute limit is hit. The examples' code is not sent in steps: a board names
its example file and the page attaches it.

Exercises run with the toolchain found on this computer (`src/lib/localrun`). A Rust exercise that
carries `#[test]`s gets **Run the tests** (`rustc --test`): every one of the exercise's own tests must
pass, and a pass is recorded with no AI involved (`src/learn/lib/exercise.ts`). Other exercises are
marked by the professor against the course's solution.

## Where a student's work is kept

| Build | Where | What |
|---|---|---|
| WalkMyCode (the app) | `.walkmycode/learn/` on this computer, one JSON file per document (`src/lib/learnStore.ts`, `/api/learn/store`) | `lessons/`, `courses/`, `profile.json`, and `extras/`: `chat-<lesson>.json`, `notebook.json`, `cards.json` |
| WalkMyCode Lite, in Claude | The viewer's own space in the artifact's database | The same documents |
| Anything else (Lite outside Claude, a hosted server) | This browser's storage | The same documents |

Lessons an earlier version kept in the browser are copied to `.walkmycode/learn/` the first time the
Learn room opens; the browser's copy is left alone. The lesson open now is in the address
(`/learn?lesson=<id>`), so a reload comes back to the same lesson, board, code and conversation, and
the Learn home's **Carry on** card shows the last thing said.

## The Learn home

One front door: **What do you want to learn today?** Type any subject and press Enter, and the professor
starts writing the lesson at once, in the course, level and length chosen under the box (a new course is
named after the subject). The ideas under it are the next step in the courses worked on last, and two fresh
subjects. **Carry on** sits beside it, then the numbers (courses, boards seen, explain-back marks, recall
due), every course as a card with a cover drawing from the drawings set, its progress and its **Next
lesson**, and a side column with what the professor knows about you and the week's recall
(`src/learn/components/Library.tsx`, mockup `docs/design/learn-home.html`).

## How the professor is told

The rules above are in the prompts, so every provider teaches the same way:

- `PERSONA` and `TEACHING` in `src/learn/lib/professor.ts`: plain words, one idea at a time, the
  analogy before the rule.
- `chatTurns` in `src/learn/lib/chat.ts`: answer first, 💡 for an analogy, hints before answers, and
  the closing "Wonder next" questions.
- `folderLessonPrompt`: teach the folder's lesson in its own order, with its own analogies and
  examples.
