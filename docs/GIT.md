# Who changed the code, and when

Line history is on by default (Settings → Editor, "Line history"; the switch
is in `src/lib/editorSettings.ts`), wherever it can work (see below). In the Code
panel's header, beside Edit (mockup:
[`design/git-history.html`](design/git-history.html)):

- **Line history** (the Settings switch) works in reading and editing alike:
  - **The cursor's line:** a faint note at its end says who, when and why:
    `Kofi Mensah, 2 Nov 2026 09:14 · Run on start`, or "Not committed yet".
  - **Pointed at or clicked:** a line's details in a box under it: the author,
    the full date and how long ago, the commit's message and short hash, and
    "How did this line get here?". A clicked line's box stays until the cursor
    leaves the line, you type, or Esc.
  - **While editing:** each line keeps its history as lines move
    (`src/ide/lineHistory.ts` carries it through CodeMirror's changes). A line
    added or changed since the last save says "Changed, not saved" rather than
    naming whoever committed the line that was there; undo back to the saved
    text and every line has its own history again.
- **Blame** (an icon button; the tooltip says "Blame: who changed each line")
  shows a gutter beside the line numbers. It is off until you press it; the choice
  then holds in every file for the rest of the session in this browser
  (sessionStorage), and a fresh start is off again. Where each block of lines that
  one commit last changed begins, it shows the author and the date and time, in
  this computer's time zone. Your own commits say "You", in yellow. Lines changed
  since the last commit say "Not committed", and lines edited and not saved
  "Changed, not saved", in green.
  - **Quiet by default:** on its own it never asks to be allowed and says nothing
    when git has no answer (no folder yet, not a git project, a new file); Blame
    then shows as off, and pressing it asks and says why.
  - **On its own:** with line history switched off in Settings, pressing Blame
    still reads it, and the note and details come with the gutter.
  - **Hover:** the full date, how long ago, the commit's message, its short hash
    and the lines it covers.
  - **Narrow editor:** the name column is shorter and the year is left out.
  - **Stays right:** it is worked out again when the file is saved or mapped
    again; in between, edits move it with the lines.
- **History** (an icon button, "History: this file's commits") lists the file's
  own commits, newest first, following it through renames: message, short hash,
  author, date and time.
- **How did this line get here?** Beside the cursor line's note, in a line's
  details, or by clicking a block's blame, a popover beside the line shows every commit that changed it,
  oldest first and the newest marked (the last 20):
  who, when, the message, the PR when the message ends in `(#41)`, and a few of
  the lines it took out and put in (`src/ide/localrun/git/LineStory.tsx`; the
  parsing is `src/lib/localrun/lineStory.ts`).
  - **The line itself, even after edits above it.** Blame knows the commit that
    last changed each line and the line's number in that commit, so the log
    starts there: `git log -L 24,24:<file> <that commit>`. Lines added or taken
    out above it, not committed or not even saved yet, don't move git onto another
    line. A line not committed (or changed and not saved) has no history to show
    and no button.

  From there:
  - **Explain this history** asks the guide, the way "Explain this" does, for
    the line's story in plain English, from those commits.
  - **Show the whole function's history** follows the lines of the function the
    line is in, as the map has them (`git log -L 20,28:<file>`). The map's lines
    are the file's on disk, so this is offered only while the file has no changes
    not committed (git checks, and refuses such a range otherwise). The op also
    takes a function's name (`-L :createTask:<file>`).
  - A PR is a link only when the repo's `origin` is a github.com URL; otherwise
    it is just its number.
  - No git, a file not in a repo or not committed, or a line no commit has
    touched: the popover says so plainly. So does a line last changed while the
    file had another name: its history isn't followed across the rename yet.
- **Source Control** (top bar) now shows each commit's date and time next to
  "3 hours ago".

## Where it works

It runs the user's own `git` on the project's folder on this computer
(`src/lib/localrun/git.ts`: `blame`, `fileLog`, `locate`), through the same
socket and consent as the terminal and Run. So it works only where WalkMyCode can
reach that folder:

- **The desktop app.** It knows the folder it picked, and reads line history and
  History straight from it, read-only, with no "run code on this computer"
  consent (`POST /api/git/read`, `src/lib/localrun/gitRead.ts`). Only `git blame`,
  `git log` and a line's `git log -L` for a file inside that folder, and the
  folder's own `git log` for Hotspots (below); the server
  refuses unless it is the desktop app's own (`WALKMYCODE_DESKTOP`) and never in
  hosted mode; git runs so that a repo's own settings can't make it start a
  program (see "What git is never asked to run" below).
  A line's history takes only whole line numbers inside the file as the given
  commit has it (or a plain function name); the commit only as a hash, which
  git must confirm is a commit (`rev-parse --verify`) and which is passed after
  `--end-of-options`, so never a branch, `HEAD~1` or an option. It asks for at
  most 21 commits and has 30 seconds. Everything else (status, commit, push)
  still goes through the socket and its consent.
- **The full web app.** It works once Source Control or Set up has been told the
  folder. A folder picked in the browser gives the page its files, not its path or
  its `.git`.
- **Not in WalkMyCode Lite, nor in WalkMyCode for Claude's page.**

## Hotspots

On the map's toolbar, **Colour by: Kind | Hotspots** colours the cards by how risky their code is:
code that changes often *and* is large breaks most. git says how many commits changed each file over
the last 30, 90 or 365 days, or all of the history (the picker beside the switch), and how many people
made them; a renamed file keeps its older name's changes. Each card scores its changes × its own lines
(a route its handler's lines, a table its schema file, an outside service the files that call it,
summed file by file), and the cards are ranked into five heat levels, so one huge file doesn't make
every other card look cold. Switching is one class on the map: nothing is laid out again. Details then
lists the five hottest files (a click selects the card), a short note on the selected card ("Changed in
23 of the last 40 commits, by 4 people. It is 39 lines long. No test file imports it." — the last part
only for JavaScript and TypeScript, from the test files' imports), **Tour the hotspots** (no AI needed)
and **Why is it hot?**, which asks the guide with the commits that changed the file; with no AI set up
it says so instead. With no git, or nothing changed in the span, a plain message stands where the
legend was and the map stays coloured by kind. The system view keeps its own colours.

It is the same read-only git as line history (`churn` in `src/lib/localrun/git.ts`, scored by
`src/lib/hotspots.ts`, shown by `src/components/Hotspots.tsx`), from the same places: the desktop app's
folder through `POST /api/git/read` (`op: "churn"`, the span one of the four, nothing else), and the
full app through the local-run socket once allowed and told the folder. git runs with no file-system
monitor, no text conversion, no outside diff program and no signature check, reads at most 3,000
commits (the legend says when there were more) and is given 30 seconds. If the folder given to Source
Control is the one above the folder that was mapped, the paths still match.

## How it finds a file

A file's map path is relative to the project's folder. In a workspace of several
folders, the path starts with the folder's label. `locate` tries both forms
inside each known folder, refuses anything outside it, and asks git for the
repo's top.

**Limit:** in a workspace of several folders, only one folder is remembered on
the server. Files in the other folders aren't found until each folder is set up.

Nothing leaves the computer: no GitHub API, no token. git reads the local
history.

Tests: `tests/gitRead.test.ts` (the desktop app's read-only route, a line's history and churn included), `tests/lineStory.test.ts` (parsing `git log -L`, PRs, GitHub links) and `tests/gitblame.test.ts`, run against a real repo made by the test, with
two authors, fixed dates, an uncommitted line and a rename; `tests/hotspots.test.ts` for the scoring.

## What git is never asked to run

Opening a project must never run a program the project's own repo names. A
repo's `.git/config` can name commands git runs while it only reads, so every
read-only call (line history, History and a line's history, through the desktop
app's route or the socket, Hotspots and the change tour) goes through `readOnlyExec`
(`src/lib/localrun/git.ts`):

- **File-system monitor:** `-c core.fsmonitor=false` on every call.
- **Text conversion and diff programs:** `blame --no-textconv`, and
  `diff --no-textconv --no-ext-diff` (`diff.<driver>.textconv`,
  `diff.external`, `diff.<driver>.command`).
- **Clean and smudge filters:** `filter.<name>.clean`, `.smudge` and
  `.process`, selected by a `filter=<name>` attribute, run whenever git reads a
  file from the working tree (a diff against a commit, blame of a changed file,
  a new file's diff). Before any command that can do that, WalkMyCode lists the
  filter drivers git knows there (`git config --null --get-regexp '^filter\.'`)
  and switches each off by name: `-c filter.<name>.clean= -c
  filter.<name>.smudge= -c filter.<name>.process= -c
  filter.<name>.required=false`. git runs no filter whose command is empty, and
  `-c` outranks every config file. Commands that never read the working tree
  (`log`, `log -L`, `rev-parse`, `ls-files`, `for-each-ref`, `merge-base`,
  `symbolic-ref`, `config`) skip the lookup; any other command gets it.

  Why not git's `--attr-source=<the empty tree>` (git 2.40+): it replaces only
  the working tree's `.gitattributes`. An attribute in `$GIT_DIR/info/attributes`,
  or in a `core.attributesFile` the repo's own config names, still selects the
  filter. Switching the drivers off covers every place an attribute can come
  from, on every git version, so no version needs checking.

  **Limits:** a driver whose name has an `=` in it can't be written as `-c
  key=value`, so a read that could run it is refused ("This repo sets up a filter
  program WalkMyCode can't switch off…"). A file a filter would normally clean
  (Git LFS, for one) is compared as it is on disk, so a changed LFS file shows
  its real contents against the pointer committed for it.

Tests: `tests/gitFilters.test.ts`, on a real repo whose config sets up filters
that would write a marker file, selected from the working tree's
`.gitattributes`, from `$GIT_DIR/info/attributes` and from a
`core.attributesFile`: plain git runs them; blame, file log, the change tour and
the desktop app's route never do.

## Tour a change

"Tour a change ▾" in the top bar (mockup: the DiffTour screen) walks through a
change in order, with its blast radius on the map. Pick what to compare: the
changes not committed yet, this branch against another (`feat/x → main`: the
folder as it is now, against where the branch left `main`), or against the
commit before. Beside it, the size: `+62 −9 · 4 files`.

- **The map:** each changed line belongs to a card (its route, else its file's
  card, and in a schema the table it defines). Changed cards get a green frame
  and their count; cards that didn't change but use one that did (import it,
  call it, read or write its table) a dashed yellow one; everything else fades.
- **The code:** added lines are marked, removed ones shown where they were, in
  the editor itself. If the file changed again since it was mapped, the marks
  are left off and the button says why.
- **The guide:** "The change, in order", one step per file from the data up to
  the screen (tables, logic, the API, the pages), played by the tour player.
  Without an AI each step says the facts: the file, the lines, the cards.
  "Explain and review" asks the guide to tell each step as a story and to note
  what a reviewer would raise, citing the lines. Under the steps: "Not changed,
  but affected".

It reads git the same way as line history: the desktop app's read-only route
(`op: "bases" | "change"`), else the local-run socket with its consent. git
only reads (`diff --numstat`, `diff`, `ls-files` for new files,
`for-each-ref`, `merge-base`), with no file-system monitor, no text
conversion, no external diff program and no filter (see "What git is never
asked to run"). A base must look like a branch name
(never an option or a range) and be a commit `rev-parse --verify` finds; only
the commit ids it resolves to reach `diff`. The diff is cut at 400 KB and at 40
new files. A `.env`, a key or a secrets file is dropped from it before it is
shown or sent to an AI (`src/lib/diffParse.ts`, `src/lib/diffTour.ts`,
`src/ide/localrun/git/ChangeTour.tsx`).

Tests: `tests/diffTour.test.ts`, on a real repo made from the example app (a
due-date branch, a new file, a `.env`, and a repo set up to try to start a
program while git reads).
