// Which WalkMyCode this build is (docs/PLAN.md, "Two versions from one codebase"):
// "full" is the web app with its server routes; "lite" is WalkMyCode Lite, one
// static page published as a Claude artifact, where the AI is the viewer's own
// Claude; "mcp" is WalkMyCode for Claude (docs/MCP.md), one static page served from
// the root by the local MCP server, where the AI is the user's own Claude
// reached through the bridge. Fixed at build time by NEXT_PUBLIC_WALKMYCODE_TARGET
// (`npm run build:lite`, `npm run build:mcp-ui`). Whether Claude is actually
// reachable is a separate, run-time question (runtime.ts): a Lite page opened
// outside Claude has no AI.
export type Target = "lite" | "full" | "mcp";

const BUILT = process.env.NEXT_PUBLIC_WALKMYCODE_TARGET;
export const TARGET: Target = BUILT === "lite" ? "lite" : BUILT === "mcp" ? "mcp" : "full";
export const LITE = TARGET === "lite";
/** WalkMyCode for Claude: the page Claude drives over the bridge. */
export const MCP = TARGET === "mcp";
/** Every room lives in one static page (Lite and the MCP page), switched in the page itself. */
export const ONE_PAGE = LITE || MCP;
