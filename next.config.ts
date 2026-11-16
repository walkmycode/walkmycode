import type { NextConfig } from "next";

// Three builds from one codebase (docs/PLAN.md, "Two versions"; docs/MCP.md):
// - WalkMyCode, the web app, with its server routes (src/app/api/**): this config only keeps ws, node-pty and sherpa-onnx-node out of the server bundle.
// - WalkMyCode Lite (`npm run build:lite`, NEXT_PUBLIC_WALKMYCODE_TARGET=lite), a static
//   export published as a Claude artifact. There only *.lite.tsx files are routes:
//   the export is one page holding every room (page.lite.tsx), and no route
//   handler is built. Assets load relative to the page, whose path inside Claude
//   is not the site root; scripts/pack-lite.mjs then makes the publish folder.
// - WalkMyCode for Claude's page (`npm run build:mcp-ui`, NEXT_PUBLIC_WALKMYCODE_TARGET=mcp),
//   a static export like Lite's (only *.mcp.tsx files are routes) but served from
//   the root by the local MCP server. With a static export, Next takes distDir as
//   the export's folder (and builds in .next): out-mcp, so Lite's out is never
//   clobbered. mcp/build.mjs copies it into mcp/dist/ui.
// - WalkMyCode desktop (`npm run desktop:build`, WALKMYCODE_STANDALONE=1, docs/DESKTOP.md): this web
//   app as it is, built with Next's standalone output: a server folder that runs on a bundled Node
//   with no node_modules install. scripts/desktop/stage.mjs copies it into the Tauri app.
// The old name, NEXT_PUBLIC_LANTERN_TARGET, still works when the new one is unset.
process.env.NEXT_PUBLIC_WALKMYCODE_TARGET ??= process.env.NEXT_PUBLIC_LANTERN_TARGET;
const target = process.env.NEXT_PUBLIC_WALKMYCODE_TARGET;

const nextConfig: NextConfig =
  target === "lite"
    ? {
        output: "export",
        pageExtensions: ["lite.tsx"],
        assetPrefix: "./",
        images: { unoptimized: true },
        trailingSlash: false,
      }
    : target === "mcp"
      ? {
          output: "export",
          pageExtensions: ["mcp.tsx"],
          distDir: "out-mcp",
          images: { unoptimized: true },
          trailingSlash: false,
        }
      : {
          // The local-run socket and terminal (src/lib/localrun) load these at run time from node_modules:
          // ws has optional native add-ons, node-pty is a native module. On-device speech to text
          // (src/lib/voice/parakeet) loads sherpa-onnx-node, a native module too, and unbzip2-stream to unpack its model.
          serverExternalPackages: ["ws", "node-pty", "sherpa-onnx-node", "unbzip2-stream"],
          // Server code that reads files from paths it builds at run time (the data folder, a project's
          // folder) makes Next's file trace take in the whole project, and the standalone build copies what
          // is traced. The desktop build runs after `cargo test`, so it copied src-tauri/target (gigabytes
          // of Rust output) into .next/standalone and filled the Windows runner's disk. The desktop server
          // reads none of these folders, and scripts/desktop/stage.mjs never kept them.
          outputFileTracingExcludes: {
            "*": ["src-tauri/**", "docs/**", "tests/**", "site/**", "mcp/**", "examples/**", "out/**", "out-mcp/**", ".claude/**", ".git/**"],
          },
          ...(process.env.WALKMYCODE_STANDALONE === "1"
            ? {
                output: "standalone" as const,
                // The desktop build is built from main, whose code ci.yml has type-checked (npm run
                // typecheck); a second check inside `next build` is only time and memory.
                typescript: { ignoreBuildErrors: true },
              }
            : {}),
        };

export default nextConfig;
