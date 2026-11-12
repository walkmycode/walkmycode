"use client";
// "New project" on the home page: for someone with no project yet. The same
// sheet as the map's Set up pill (./SetupSheet.tsx), opened straight on the
// New project form; the first time, the "run code on this computer" consent
// asks first. When the project is made it opens on the map, and its setup
// carries on there. Only where code can run here (never Lite).
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { LOCAL_BUILD } from "../client";
import { useConsent } from "../Consent";
import { useLocalStatus } from "../OutputArea";
import SetupSheet from "./SetupSheet";
import { openNewProject, setupStore } from "./store";
import "./setup.css";

export default function NewProjectButton() {
  const status = useLocalStatus();
  const s = useSyncExternalStore(setupStore.subscribe, setupStore.get, setupStore.get);
  const { ask, dialog } = useConsent();
  if (!LOCAL_BUILD || !status?.available) return null;
  return (
    <>
      <button
        type="button"
        className="ctl new-project-cta"
        onClick={async () => {
          if (!status.allowed && !(await ask())) return;
          void openNewProject();
        }}
      >
        <span aria-hidden>＋</span> Start a new project
      </button>
      {typeof document !== "undefined" && createPortal(<AnimatePresence>{s.open && <SetupSheet key="sheet" name="New project" />}</AnimatePresence>, document.querySelector(".root") ?? document.body)}
      {dialog}
    </>
  );
}
