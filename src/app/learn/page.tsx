import type { Metadata } from "next";
import App from "@/learn/components/App";
import "katex/dist/katex.min.css";
import "@/learn/learn.css";

export const metadata: Metadata = {
  title: "Learn · WalkMyCode",
  description: "Any subject, from beginner to mastery: chalkboard lessons from a patient professor, with code you can run and step through.",
};

export default function LearnPage() {
  // App draws the shared top bar, then the room itself inside .learn.
  return <App />;
}
