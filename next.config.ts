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
        };

export default nextConfig;
