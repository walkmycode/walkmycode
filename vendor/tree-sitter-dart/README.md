# tree-sitter-dart.wasm

The Dart grammar Lantern parses `.dart` files with (`src/analyzer/parser.ts`).

**Why it is kept here.** No npm package ships a Dart grammar that web-tree-sitter 0.27
can load: `tree-sitter-dart@1.0.0` (2023) and `tree-sitter-wasms` were built with
tree-sitter-cli 0.19/0.20, whose old module format web-tree-sitter 0.27 rejects.
So the grammar is built from source and the result kept in this folder.

**Where it came from.**

- Grammar: https://github.com/UserNobody14/tree-sitter-dart, commit `be07cf7`
  (6 July 2026, "fix: parse generic method invocation with single type argument").
  Its committed `src/parser.c` is language ABI 15, so it was not regenerated.
- Built with tree-sitter-cli 0.27.0 (the version of web-tree-sitter in package.json):
  `npx tree-sitter-cli@0.27.0 build --wasm -o tree-sitter-dart.wasm` in a checkout of
  that commit. The CLI downloads its own wasi-sdk and binaryen to do this.
- SHA-256 of the file: `2BA07D83DF87B8618540CB31966DE22EB1D57E27DC04E968745CE7E29E386F4C`.

**Licence.** MIT, copyright (c) 2020-2023 UserNobody14 and others; the full text is in
`LICENSE` beside this file. (The grammar's package.json says ISC; its LICENSE file is MIT.)

**To update it**, build a newer commit the same way, check that `npm test` still passes,
and replace the file and the commit and hash above. `scripts/copy-wasm.mjs` copies it to
`public/wasm/` for the browser on `npm install`.
