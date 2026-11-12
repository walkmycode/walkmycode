// Copies the tree-sitter runtime and grammars into public/wasm so the
// browser can parse local folders. Runs on postinstall. The Dart grammar
// is not on npm in a form this runtime loads, so it comes from vendor/.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "public", "wasm");
mkdirSync(out, { recursive: true });

const files = [
  "node_modules/web-tree-sitter/web-tree-sitter.wasm",
  "node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm",
  "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm",
  "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm",
  "node_modules/tree-sitter-python/tree-sitter-python.wasm",
  "node_modules/tree-sitter-php/tree-sitter-php.wasm",
  "vendor/tree-sitter-dart/tree-sitter-dart.wasm",
];
for (const f of files) {
  copyFileSync(join(process.cwd(), f), join(out, f.split("/").pop()));
}
console.log(`copied ${files.length} wasm files to public/wasm`);
