// npm run build:lite — WalkMyCode Lite, the Claude-artifact build, as a static
// export in out/. next.config.ts reads NEXT_PUBLIC_WALKMYCODE_TARGET=lite: only
// *.lite.tsx files are routes, so no API route is built. Set here rather than in
// the npm script so it works the same in every shell. Then `npm run pack:lite`
// turns out/ into the folder the artifact publisher takes.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const run = (args, env = process.env) => spawnSync(process.execPath, args, { stdio: "inherit", env });

// The tree-sitter runtime and grammars must be in public/wasm to be exported (npm ci copies them).
if (!existsSync("public/wasm/web-tree-sitter.wasm") && run(["scripts/copy-wasm.mjs"]).status !== 0) process.exit(1);
// The example app the home page offers, packed into public/examples/ (scripts/pack-example.mjs).
if (run(["scripts/pack-example.mjs"]).status !== 0) process.exit(1);

rmSync("out", { recursive: true, force: true });
const r = run([require.resolve("next/dist/bin/next"), "build"], { ...process.env, NEXT_PUBLIC_WALKMYCODE_TARGET: "lite" });
process.exit(r.status ?? 1);
