// WalkMyCode for Claude's root layout. In the MCP build only *.mcp.tsx files are
// routes (next.config.ts), so this stands in for layout.tsx: the same layout,
// named for the page Claude drives, with the page's own few styles.
import type { Metadata } from "next";
import "./mcp.css";

export { default } from "./layout";

export const metadata: Metadata = {
  title: "WalkMyCode",
  description: "Your own AI app explains the code while WalkMyCode shows it: the map, the lines, the tours and the voice.",
};
