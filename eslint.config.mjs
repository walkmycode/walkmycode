import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // WalkMyCode Lite's publish folder (npm run pack:lite): bundles, not source.
    "publish-lite/**",
    // WalkMyCode for Claude's bundle (npm run build:mcp) and its page's export (npm run build:mcp-ui).
    "mcp/dist/**",
    "out-mcp/**",
    // Hand-written repos the analyzer tests read as input, not code of ours.
    "tests/fixtures/**",
    // The example app the home page offers (packed by scripts/pack-example.mjs): its code, not ours.
    "examples/**",
    "public/examples/**",
    // Vendored runtimes served as-is to the page (MicroPython, sql.js, tree-sitter wasm glue).
    "public/py/micropython.mjs",
    "public/sql/**",
    "public/wasm/**",
    // Temporary git worktrees made for background builds.
    ".claude/**",
  ]),
]);

export default eslintConfig;
