# Debugging

WalkMyCode has two debuggers.

## In the page: record, then replay (Python, JavaScript/TypeScript)

🐞 Debug on Python (MicroPython in the page, or the laptop's Python) or JS/TS runs the code once while recording
every line (`public/py/debugger.py`, `src/ide/jsdebug.ts`), then lets you step back and forth through the
recording (`src/ide/DebugPanel.tsx`). Nothing is live: the program has already finished.

## On this computer: live (Rust; C#, Go, Python, Node next)

For code that runs on **This computer** (Run on: This computer), 🐞 Debug runs it under a real debugger: the
program stops at your breakpoints, and you continue, step over, into and out of it, see its variables (a
`Vec`'s items, a struct's fields, opened a level at a time) and its call stack. Mockup:
`docs/design/debug-native.html`.

| Language | Debugger | Licence | Built with |
|---|---|---|---|
| Rust | [CodeLLDB](https://github.com/vadimcn/codelldb) 1.12.3 | MIT | `cargo build` (the file's own example or bin) inside a crate, else `rustc -g` |

Planned: C# (netcoredbg), Go (Delve), Python (debugpy), Node (js-debug), C/C++ (CodeLLDB), Java (java-debug).
Microsoft's own C#/C++ debuggers (vsdbg) are licensed for Visual Studio products only, so they are not used.

### How it works

- `src/lib/localrun/debug/session.ts`: builds the program with debug info, starts the adapter and drives it over
  the **Debug Adapter Protocol** (`dap.ts`, the protocol VS Code uses). WalkMyCode listens on a loopback port and
  the adapter connects to it (`codelldb --connect PORT`); the program writes to the debugger's own console, whose
  output is the program's output. The page sees plain views: where it stopped, the frames (the user's own and the
  standard library's), the variables of the frame on show; it says continue, next, stepIn, stepOut, pause, stop.
- The page talks to it over the local-run socket (`src/lib/localrun/protocol.ts`, `debug-*` messages), with the
  same consent as Run on This computer. At most two debugs per page.
- `src/ide/LiveDebug.tsx` is the panel above the Output; `src/ide/Ide.tsx` wires breakpoints (set or cleared
  while debugging reach the debugger at once), the stopped line, and the keys (F5, F10, F11, Shift+F11, Shift+F5).

### Getting the debugger

None ships with WalkMyCode. The first Debug in a language offers to fetch its debugger: the page shows its name,
version, size, licence, source and where it will be kept. On yes, `src/lib/localrun/debug/install.ts` downloads
the pinned release (`adapters.ts`), checks it against the SHA-256 GitHub publishes for it, unpacks it
(`zip.ts`, Node's own zlib; no path may leave the folder) beside its final place and moves it in, then marks it
ready (`.ok`). A download that doesn't match is not kept. They live in `~/.walkmycode/debuggers/<id>-<version>`;
deleting the folder makes WalkMyCode ask again.

### Tests

`tests/debugNative.test.ts`: the framing, the unpacker (and a path that tries to leave the folder), the
installer's checksum, Rust's type names, cargo's targets; and, where CodeLLDB and Rust are installed, a whole
session through the hub (build, stop at a breakpoint, read and open variables, step, end). It is skipped on CI.
