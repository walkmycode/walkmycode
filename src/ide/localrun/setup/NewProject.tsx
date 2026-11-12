"use client";
// "New project" in the setup sheet: pick a starter, name it, say where it goes
// (and, if you like, what it should do: the guide offers to build that once it's
// open), and Make it. The making itself is the sheet's activity feed (./store.ts
// createProject): tools installed, the framework's own create, then the
// project's own setup, one light hopping through all of it.
import { useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { motionOff, springs } from "@/lib/motion";
import { BRIEF_MAX } from "@/lib/starterGuide";
import { checkCommands, FRAMEWORKS, MAX_COMMANDS } from "@/lib/localrun/frameworks";
import { closeNewProject, createProject, setupStore } from "./store";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Keyed by the asked starter and name (SetupSheet), so a form opened again with new ones (Claude's walkmycode_new_project) starts from them. */
export default function NewProject() {
  const s = useSyncExternalStore(setupStore.subscribe, setupStore.get, setupStore.get);
  const c = s.creating;
  const [starter, setStarter] = useState(c?.ask.starter ?? "laravel");
  const [name, setName] = useState(c?.ask.name ?? "");
  const [parent, setParent] = useState(c?.ask.parent ?? "");
  const [brief, setBrief] = useState(c?.brief ?? "");
  // "Any framework": which one, and its commands as the user will run them (one per line, editable).
  const [fw, setFw] = useState(FRAMEWORKS[0].id);
  const [cmds, setCmds] = useState<string | null>(null);
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  const custom = starter === "custom";
  const pickFw = (id: string) => {
    setFw(id);
    setCmds(null);
  };
  // A failure while making shows the feed (and its output) instead of the form.
  if (!c || !(c.phase === "form" || (c.phase === "error" && !s.runs["+new"]))) return null;

  const badName = name.length > 0 && !NAME.test(name);
  const framework = FRAMEWORKS.find((f) => f.id === fw) ?? FRAMEWORKS[0];
  const commandText = cmds ?? framework.commands(NAME.test(name) ? name : "my-app", windows).join("\n");
  const commandList = commandText.split("\n").map((l) => l.trim()).filter(Boolean);
  const commandWhy = custom ? checkCommands(commandList) : null;
  const where = parent.trim() || c.parent;
  const sep = where.includes("\\") ? "\\" : "/";

  return (
    <motion.form
      className="new-project"
      initial={motionOff() ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.settle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!NAME.test(name)) return;
        if (custom && commandWhy) return;
        void createProject(
          { starter, name, ...(parent.trim() ? { parent: parent.trim() } : {}), ...(custom ? { custom: { framework: framework.label, commands: commandList } } : {}) },
          brief,
        );
      }}
    >
      <div className="np-starters" role="radiogroup" aria-label="Starter">
        {(c.starters.length ? c.starters : PLACEHOLDER).map((st, i) => (
          <motion.button
            key={st.id}
            type="button"
            role="radio"
            aria-checked={starter === st.id}
            className={`np-starter${starter === st.id ? " on" : ""}`}
            onClick={() => setStarter(st.id)}
            initial={motionOff() ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.settle, delay: motionOff() ? 0 : i * 0.04 }}
          >
            <b>{st.label}</b>
            <span>{st.blurb}</span>
            <small>needs {st.needs}</small>
          </motion.button>
        ))}
        <button type="button" role="radio" aria-checked={custom} className={`np-starter np-any${custom ? " on" : ""}`} onClick={() => setStarter("custom")}>
          <b>✦ Any framework</b>
          <span>Its own way to start a project, from its docs</span>
          <small>you check the steps before they run</small>
        </button>
      </div>
      {custom && (
        <div className="np-custom">
          <div className="np-chips" role="radiogroup" aria-label="Framework">
            {FRAMEWORKS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={fw === f.id} className={`np-chip${fw === f.id ? " on" : ""}`} onClick={() => pickFw(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="np-field np-steps">
            <span>
              The steps, run in order in the new folder <small>edit them if you like · one per line</small>
            </span>
            <textarea className="field mono" rows={Math.min(MAX_COMMANDS, Math.max(3, commandList.length + 1))} value={commandText} onChange={(e) => setCmds(e.target.value)} spellCheck={false} placeholder="the framework's own create command, one per line" />
          </label>
          <p className="setup-fine">
            {framework.id === "other" ? "Write the commands from your framework's docs." : <>Needs {framework.needs}. From {framework.source}.</>} Nothing runs until you press Make it.
          </p>
          {commandWhy && <p className="setup-msg bad">{commandWhy}</p>}
        </div>
      )}
      <label className="np-field">
        <span>Name</span>
        <input className="field mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="todo-app" spellCheck={false} autoFocus />
      </label>
      <label className="np-field">
        <span>Folder</span>
        <input className="field mono" value={parent} onChange={(e) => setParent(e.target.value)} placeholder={c.parent || "~/WalkMyCode Projects"} spellCheck={false} />
      </label>
      <p className="setup-fine mono">
        {NAME.test(name) ? `→ ${where}${sep}${name}` : badName ? "Letters, numbers, dots, dashes or underscores; no spaces." : "Name it to see where it goes."}
      </p>
      {/* Optional, and the reason most people start one: once it's open, the guide offers to build this first. */}
      <motion.label
        className="np-brief"
        initial={motionOff() ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.settle, delay: motionOff() ? 0 : 0.12 }}
      >
        <span>
          What should it do? <small>optional</small>
        </span>
        <textarea
          className="field"
          rows={2}
          maxLength={BRIEF_MAX}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          // Enter is a new line here; Ctrl/⌘+Enter makes it, as Make it would.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="a todo list where I can add, tick off and delete tasks"
        />
      </motion.label>
      {c.phase === "error" && c.message && <p className="setup-msg bad">{c.message}</p>}
      <p className="setup-fine">
        WalkMyCode installs what the starter needs (asking Windows or Homebrew where it must), makes the project the framework&rsquo;s own way, sets it up,
        and opens it on the map{brief.trim() ? <>, where the guide offers to build what you described</> : null}.
      </p>
      <div className="setup-acts">
        <button type="button" className="ctl" onClick={closeNewProject}>
          Cancel
        </button>
        <button className="ctl primary" disabled={!NAME.test(name) || !!commandWhy}>
          {custom ? `Run these ${commandList.length} step${commandList.length === 1 ? "" : "s"}` : "Make it"}
        </button>
      </div>
    </motion.form>
  );
}

const PLACEHOLDER = [
  { id: "laravel", label: "Laravel", blurb: "PHP web app with a SQLite database", needs: "PHP and Composer" },
  { id: "next", label: "Next.js", blurb: "React app with the App Router", needs: "Node.js" },
  { id: "vite-react", label: "Vite + React", blurb: "A fast React front end", needs: "Node.js" },
  { id: "fastapi", label: "FastAPI", blurb: "A Python API", needs: "Python" },
  { id: "express", label: "Express", blurb: "A small Node.js server", needs: "Node.js" },
];
