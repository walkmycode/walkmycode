"use client";
// The guide's chalkboard as a dock panel. Drawn again only when what it shows
// changes, not on every click on the map.
import { useMemo } from "react";
import Guide from "@/components/Guide";
import { useShell } from "../WorkspaceProvider";

export default function GuidePanel() {
  const { repoView, job, openAt, setTour, tour, step, setStep, askFree } = useShell();
  return useMemo(
    () => (
      <div className="dock-panel guide">
        <Guide repo={repoView} job={job} onCite={openAt} onTour={setTour} tour={tour} step={step} onStep={setStep} onAsk={askFree} />
      </div>
    ),
    [repoView, job, openAt, setTour, tour, step, setStep, askFree],
  );
}
