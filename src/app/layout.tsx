import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
// dockview's sheet first, so WalkMyCode's theme (globals.css) wins; both load at
// start-up, which pop-out windows need (they copy the page's sheets once).
import "dockview-react/dist/styles/dockview.css";
import "./globals.css";
import "./home.css";
import "./settings.css";
import LanternLight from "@/components/LanternLight";
import { MOTION_BOOT } from "@/lib/motion";
import { LOOK_BOOT } from "@/lib/look";

// One font family everywhere, as in an IDE: Inter for all text (controls, titles, the guide's
// answers, diagrams), JetBrains Mono only for code.
// latin-ext too: Polish, Czech, Turkish and the like keep the same face instead of a fallback per letter.
const sans = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "WalkMyCode",
  description: "A tour guide for the code you generated: see the map, follow a button to the database, ask in plain English.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The motion switch, text size and density (Settings → Motion & look) are set on <html> before the first paint, so a page
    // that should be still never starts moving; React keeps that attribute when it hydrates.
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT + LOOK_BOOT }} />
      </head>
      <body>
        <div className={`${sans.variable} ${mono.variable} root`}>{children}</div>
        {/* The light: one dot that travels between the panels, and outlives a route change. */}
        <LanternLight />
      </body>
    </html>
  );
}
