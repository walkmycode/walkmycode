import type { Metadata } from "next";
import ScenesGallery from "@/learn/components/ScenesGallery";

export const metadata: Metadata = {
  title: "Scenes · WalkMyCode",
  description: "Every kind of picture the professor draws: timelines, flows, stacks, comparisons, flowcharts, state machines, UML, ER diagrams, mind maps and sequence diagrams.",
};

export default function ScenesPage() {
  return <ScenesGallery />;
}
