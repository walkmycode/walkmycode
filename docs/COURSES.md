# Writing a course for Learn

Learn can teach a course you wrote yourself, in any subject: history, biology, law, music theory,
Rust. You keep the course as a folder of Markdown files on your computer; the professor teaches it in
your order, with your words and analogies, sets your exercises, and marks answers against your model
answers.

In the Learn room choose **Course from a folder**, type the folder's path and press **Read the
folder**. You see the outline first; nothing is added until you say so. To start from an example,
type the path of a folder that does not exist yet and press **Make a starter course there**: Learn
writes three small lessons, one in each shape below, for you to copy and change
(`src/learn/lib/starterCourse.ts`).

This works in the full app on your own computer. The folder is only read. Hidden files, `.env` files
and build folders (`node_modules`, `target`, `dist`, `build`, `venv` and the like) are never opened.

## Any folder of study material

You do not have to write anything new. A folder of what you already have is a course: lecture notes,
a textbook's chapters, handouts, slides, past papers.

| Learn reads | As |
|---|---|
| Markdown (`.md`) and plain text (`.txt`) | The text. In plain text, a line such as `CHAPTER TITLE`, `1.2 Alliances` or `Chapter 3: The spark` is taken as a heading. |
| Word (`.docx`) | Its text. Heading 1 to 3 and Title styles become headings; lists become lists. |
| PowerPoint (`.pptx`) | Its text. Each slide is a section, named by its title. |
| PDF | The text of its pages. A scanned PDF is pictures of pages and has no text to read: Learn says so. |

Pictures, table layouts and formatting are left behind. Files over 12 MB are not opened.

How a folder becomes an outline:

- **Subfolders are units.** A folder with no subfolders is one unit.
- **Each document is a lesson**, and its headings are the lesson's sections.
- **Numbers decide, where there are any.** In a folder where some names start with a number, only the
  numbered documents are lessons, in that order; `notes.md` beside them is left out. In a folder with
  no numbers at all, every document is a lesson, in alphabetical order.
- **Question papers.** A file whose name says it is questions (`questions`, `problems`, `exercises`,
  `worksheet`, `past paper`, `quiz`, `homework`, `exam`, `test`, `practice`) becomes exercise boards.
  It goes with the lesson that has the same number (`03_causes.md` and `03_questions.md`) or the
  same subject (`The heart.pptx` and `Heart questions.md`). With no such lesson it is a lesson of its
  own, opened with a short reminder of the ideas its questions need.
- **Answer keys and mark schemes.** A file whose name says it is answers (`answers`, `solutions`,
  `mark scheme`, `answer key`, `memo`) is matched to its paper by number, then by subject, then when
  there is only one paper. It is never a lesson and never shown before a real attempt.
- **Numbered questions** (`1.`, `2)`) are one exercise each, answered by the key's entry of the same
  number. A mark scheme that is not numbered goes with every question of its paper.

How answers are marked:

- **A mark scheme with separate points** is marked point by point: each point is shown as covered or
  not, with a remark, in the student's own terms and never in the scheme's wording.
- **A calculation** is checked by its final answer, then its working. A wrong answer is told the
  first step that goes wrong, not the right value.
- **An essay or short answer** is judged by its ideas, in any words.

A long document (more than about 24,000 characters) is written into a lesson part by part. Even so, one
lesson holds about eight parts: split a whole textbook into a file per chapter.

## Writing a course from scratch: the folder

```text
my-course/
  README.md                 # Course title, then one paragraph about it
  01_first-unit/            a unit: any folder that holds lessons
    01_a-lesson.md          a lesson in one file
    02_another-lesson/      a lesson with files of its own
      README.md             the lesson
      examples/             code to run, one idea per file
      exercises/            ex01_name.md or ex01_name.py …
      solutions/            sol01_name.md or sol01_name.py …
  02_second-unit/
```

| Rule | Detail |
|---|---|
| Number everything | Units and lessons are taught in the order of their names, and numbers sort as numbers: `2_x` comes before `10_x`. |
| A lesson in one file | A document (Markdown, text, Word, PowerPoint or PDF). Where the folder numbers things, the numbered ones: `03_causes.md`, and files without a number (`NOTES.md`, `glossary.md`) are not lessons. |
| A lesson in a folder | A folder with a `README.md`. It needs either a number at the start of its name, or one of `examples/`, `exercises/`, `solutions/`, `src/` (or a `Cargo.toml`, `package.json` or `pyproject.toml`) beside the README. |
| Units | The folder a lesson sits in is its unit. A folder that has lessons under it is a unit, and its own `README.md` is not taught. Lessons may sit up to four folders deep. |
| The course | The top `README.md` gives the course its name (the `#` heading) and description (the first paragraph). |
| A course of one lesson | A folder holding just a `README.md` is taught as one lesson. |

## A lesson

```markdown
# The lesson's title

One paragraph: what it teaches and why it matters.

> 💡 **The big picture:** one everyday picture for the whole lesson.

## First idea

Explain it in plain words.

> 💡 **Analogy:** a picture a ten-year-old would understand.

## Second idea

…

## Checklist

- [ ] What the lesson must cover

## Exercises

1. A question the student answers in their own words.
2. Another question.

## Answers

1. The model answer to question 1.
2. The model answer to question 2.
```

| You write | The professor |
|---|---|
| `# Title` and the first paragraph | The lesson's name, and its summary in the outline. |
| Each `## Section` | One or two boards, in your order. Nothing is added and nothing is skipped. |
| A quote block that starts with 💡 | That section's analogy, in your words. Where you give none, the professor writes one that extends the lesson's picture. |
| Tables and code blocks | Shown on the board where they help. |
| `- [ ]` lines | What the lesson must cover. A lesson that has only a checklist is still taught: the professor writes it in the style of the rest of your course. |

Write the analogy first and the rule after it. A good one uses things a child has touched, carries one
idea, says what stands for what, and is true to the subject. `docs/LEARNING.md` has the reasons.

## Exercises answered in words

Any subject can have these. There are two ways to write them, and a lesson may use both.

**In the lesson's own text.** A section headed `## Exercises` with a numbered list, and optionally a
section headed `## Answers` numbered the same way. `Practice`, `Practise`, `Questions`, `Your turn`
and `Try it` work for the first heading; `Model answers`, `Solutions` and `Answer key` for the second.
A question may run over several lines.

**As files**, when a question or its answer is long:

```text
exercises/ex01_rewrite.md      the question (a # heading becomes its title)
solutions/sol01_rewrite.md     the model answer
```

Either way:

- Each question becomes its own board, with a box for the student's answer.
- The student can ask for hints: a nudge, then a pointer, then a near-answer.
- **Check my answer** has the professor mark it against your model answer, judging the ideas and not
  the wording. A different answer that is right passes. Without a model answer it is marked against
  what the lesson taught.
- The model answer is never put on a board and never sent to the professor who writes the lesson. The
  student can open it only after three hints or after having an answer checked.

## Exercises in code

For programming courses. Exercise and solution files pair by number: `ex01_…` with `sol01_…`.

| File | What it is |
|---|---|
| `examples/*.py` (or `.js`, `.ts`, `.sql`, `.rs`) | One runnable idea. A board that teaches it gets **Run the example**. |
| `exercises/ex01_name.py` | The starting code. The comment at the top of the file is the task; its first line is the title. |
| `solutions/sol01_name.py` | Your answer. The professor marks against it and chooses hints from it. |
| `src/main.*` | A small project for the professor to read. |

Code runs with the toolchain found on the student's computer. A Rust exercise that carries `#[test]`s
gets **Run the tests**: every one of your tests must pass, and the pass is recorded without any AI.
Exercises in other languages are marked by the professor against your solution.

## What is not supported yet

- Pictures in a lesson, and scanned PDFs. Diagrams are drawn by the professor from your text.
- Spreadsheets, and older `.doc` and `.ppt` files: save them as `.docx` and `.pptx`.
- Maths written as pictures or in an equation editor: only maths typed as text is read.
- Running an exercise's own tests in languages other than Rust.
- Courses in WalkMyCode Lite or on a hosted server: a course folder is read from your own computer.
