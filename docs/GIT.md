# Who changed the code, and when

In the Code panel's header, beside Edit (mockup:
[`design/git-history.html`](design/git-history.html)):

- **Blame** puts a gutter beside the line numbers. Where each block of lines that
  one commit last changed begins, it shows the author and the date and time, in
  this computer's time zone. Your own commits say "You", in yellow. Lines changed
  since the last commit say "Not committed", in green.
  - **Hover:** the full date, how long ago, the commit's message, its short hash
    and the lines it covers.
  - **Narrow editor:** the name column is shorter and the year is left out.
  - **Stays on:** it stays on for that file while you move panels around, and is
    worked out again when the file is saved or mapped again.
  - **While editing:** it's hidden, because the lines have moved.
- **History** lists the file's own commits, newest first, following it through
  renames: message, short hash, author, date and time.
- **Source Control** (top bar) now shows each commit's date and time next to
  "3 hours ago".

## Where it works

It runs the user's own `git` on the project's folder on this computer
(`src/lib/localrun/git.ts`: `blame`, `fileLog`, `locate`), through the same
socket and consent as the terminal and Run. So it works only where WalkMyCode can
reach that folder:

- **The desktop app.** It knows the folder it picked, and tells the server the
  first time Blame or History is used.
- **The full web app.** It works once Source Control or Set up has been told the
  folder. A folder picked in the browser gives the page its files, not its path or
  its `.git`.
- **Not in WalkMyCode Lite, nor in WalkMyCode for Claude's page.**

## How it finds a file

A file's map path is relative to the project's folder. In a workspace of several
folders, the path starts with the folder's label. `locate` tries both forms
inside each known folder, refuses anything outside it, and asks git for the
repo's top.

**Limit:** in a workspace of several folders, only one folder is remembered on
the server. Files in the other folders aren't found until each folder is set up.

Nothing leaves the computer: no GitHub API, no token. git reads the local
history.

Tests: `tests/gitblame.test.ts`, run against a real repo made by the test, with
two authors, fixed dates, an uncommitted line and a rename.
