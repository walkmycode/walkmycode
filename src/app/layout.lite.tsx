// WalkMyCode Lite's root layout. In the Lite build only *.lite.tsx files are routes
// (next.config.ts), so this stands in for layout.tsx: the same layout, named for
// the artifact.
import type { Metadata } from "next";

export { default } from "./layout";

export const metadata: Metadata = {
  title: "WalkMyCode Lite",
  description: "A tour guide for the code you generated, inside Claude: see the map, follow a button to the database, ask in plain English.",
};
