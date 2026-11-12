// "New project" (src/ide/localrun/setup/): a project from scratch, made the
// way its own framework makes one, with whatever tools it needs installed
// first. The plan is asked for again after every round: the first round may
// only install PHP, the next Composer, the next runs `composer create-project`;
// once the folder exists the plan is empty and the project's own setup
// (./setup.ts) takes over. As with setup, the page names a starter, a folder
// name and a parent folder; the commands are only ever made here.
import { checkCommands } from "./frameworks";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { composerPhar, installStep, phpConfigStep, toolInfo, type PlannedStep, type SetupEnv, type ToolKey } from "./setup";
import { findOnPath } from "./toolchains";
import type { SetupStep } from "./setupTypes";

export type StarterId = "laravel" | "next" | "vite-react" | "fastapi" | "express";

export interface StarterView {
  id: StarterId;
  label: string;
  /** One line: what you get. */
  blurb: string;
  /** The tools it needs, in words. */
  needs: string;
}

interface Starter extends StarterView {
  tools: ToolKey[];
  /** The step that makes the folder (cwd: the parent folder). */
  create(c: StarterCtx, parent: string, name: string): PlannedStep | null;
}

interface StarterCtx {
  find: (cmd: string) => string | null;
  platform: NodeJS.Platform;
}

const step = (o: Omit<PlannedStep, "id" | "label"> & { label?: string }): PlannedStep => ({ id: "create", label: o.label ?? "Make the project", ...o });

const STARTERS: Starter[] = [
  {
    id: "laravel",
    label: "Laravel",
    blurb: "PHP web app with a SQLite database, ready to migrate",
    needs: "PHP and Composer",
    tools: ["phpcore", "php"],
    create(c, parent, name) {
      const php = c.find("php");
      const composer = c.find("composer");
      const phar = existsSync(composerPhar()) ? composerPhar() : null;
      if (!php || (!composer && !phar)) return null;
      const args = ["create-project", "laravel/laravel", name, "--no-interaction", "--prefer-dist", "--no-audit"];
      return step({ shown: `composer create-project laravel/laravel ${name}`, progress: "composer", cwd: parent, file: composer ?? php, args: composer ? args : [phar!, ...args] });
    },
  },
  {
    id: "next",
    label: "Next.js",
    blurb: "React app with the App Router, TypeScript and Tailwind",
    needs: "Node.js",
    tools: ["node"],
    create(c, parent, name) {
      const npx = c.find("npx");
      return npx ? step({ shown: `npx create-next-app@latest ${name}`, progress: "npm", cwd: parent, file: npx, args: ["--yes", "create-next-app@latest", name, "--ts", "--eslint", "--tailwind", "--app", "--src-dir", "--import-alias", "@/*", "--use-npm", "--yes"] }) : null;
    },
  },
  {
    id: "vite-react",
    label: "Vite + React",
    blurb: "A fast React front end in TypeScript",
    needs: "Node.js",
    tools: ["node"],
    create(c, parent, name) {
      const npm = c.find("npm");
      return npm ? step({ shown: `npm create vite@latest ${name} -- --template react-ts`, progress: "npm", cwd: parent, file: npm, args: ["create", "vite@latest", name, "--yes", "--", "--template", "react-ts"] }) : null;
    },
  },
  {
    id: "fastapi",
    label: "FastAPI",
    blurb: "A Python API with one route, ready to run with uvicorn",
    needs: "Python",
    tools: ["python"],
    create(_c, parent, name) {
      return step({ shown: `write ${name}/main.py and requirements.txt`, progress: "copy", cwd: parent, file: null, args: [name, "fastapi"], builtin: "starter" });
    },
  },
  {
    id: "express",
    label: "Express",
    blurb: "A small Node.js server with one route",
    needs: "Node.js",
    tools: ["node"],
    create(_c, parent, name) {
      return step({ shown: `write ${name}/package.json and index.js`, progress: "copy", cwd: parent, file: null, args: [name, "express"], builtin: "starter" });
    },
  },
];

export const starterList = (): StarterView[] => STARTERS.map(({ id, label, blurb, needs }) => ({ id, label, blurb, needs }));

/** Where new projects go unless the user says otherwise. */
export const defaultParent = () => join(homedir(), "WalkMyCode Projects");

export const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export interface NewPlan {
  /** The next round's steps: tools to install, or the step that makes the folder. Empty once it exists. */
  steps: PlannedStep[];
  /** The project's folder (it exists when `steps` is empty). */
  root: string;
}

/**
 * What's next for a new project. `existed` names folders this server made
 * itself, so a project half-way through (made, not yet set up) carries on
 * instead of being refused as "already there".
 */
export function planNew(starter: string, name: string, parent: string, o: SetupEnv, existed: (root: string) => boolean = () => false, custom?: { commands: string[]; done: number }): NewPlan | { error: string } {
  if (starter === "custom") return planCustom(name, parent, o, existed, custom);
  const s = STARTERS.find((x) => x.id === starter);
  if (!s) return { error: "That isn't a starter WalkMyCode knows." };
  if (!NAME.test(name)) return { error: "Use letters, numbers, dots, dashes or underscores for the name (no spaces)." };
  if (!isAbsolute(parent)) return { error: "The folder to put it in must be a full path." };
  const root = join(parent, name);
  const exists = o.exists ?? existsSync;
  if (existsSync(root)) {
    return existed(root) ? { steps: [], root } : { error: `${root} is already there. Pick another name, or open that folder instead.` };
  }
  const c = { ...o, find: (cmd: string) => findOnPath(cmd, { env: o.env, platform: o.platform, exists }), python: null };
  // Tools first, one round each (PHP before Composer: Composer is run with PHP).
  for (const key of s.tools) {
    const have = key === "php" ? !!(c.find("composer") || existsSync(composerPhar())) : !!c.find(key === "phpcore" ? "php" : key === "node" ? "node" : key);
    if (have) {
      // PHP is there but its extensions are off (no php.ini): turn on what Composer and Laravel need first.
      const ini = key === "phpcore" ? phpConfigStep(c, parent) : null;
      if (ini) return { steps: [ini], root };
      continue;
    }
    const st = installStep(c, key, parent);
    if (!st) {
      const t = toolInfo(key, o.platform);
      return { error: `${t.tool} isn't on this computer, and WalkMyCode can't install it here. Install it (${t.command}, or see ${t.url}), then try again.` };
    }
    return { steps: [st], root };
  }
  const create = s.create(c, parent, name);
  if (!create) return { error: `${s.label} needs ${s.needs}, and they couldn't be found after installing.` };
  return { steps: [create], root };
}

/**
 * "Any framework": the user's checked commands, one step each, run in the new folder (made before the first);
 * `done` of them have run. Each runs through the system shell, as the user would type it.
 */
function planCustom(name: string, parent: string, o: SetupEnv, existed: (root: string) => boolean, custom?: { commands: string[]; done: number }): NewPlan | { error: string } {
  if (!NAME.test(name)) return { error: "Use letters, numbers, dots, dashes or underscores for the name (no spaces)." };
  if (!isAbsolute(parent)) return { error: "The folder to put it in must be a full path." };
  const commands = (custom?.commands ?? []).map((c) => c.trim()).filter(Boolean);
  const why = checkCommands(commands);
  if (why) return { error: why };
  const root = join(parent, name);
  const done = custom?.done ?? 0;
  if (done === 0 && existsSync(root) && !existed(root)) return { error: `${root} is already there. Pick another name, or open that folder instead.` };
  const win = o.platform === "win32";
  const shell = win ? (o.env.ComSpec ?? o.env.COMSPEC ?? "cmd.exe") : "/bin/sh";
  const steps = commands.slice(done).map((cmd, k): PlannedStep => ({
    id: `cmd-${done + k}`,
    label: `Step ${done + k + 1} of ${commands.length}`,
    shown: cmd,
    progress: "npm",
    cwd: root,
    file: shell,
    args: win ? ["/d", "/s", "/c", cmd] : ["-c", cmd],
  }));
  return { steps: steps.slice(0, 1), root };
}

/** The page's view of a plan step. */
export const publicStep = ({ id, label, shown, progress, expect }: PlannedStep): SetupStep => ({ id, label, shown, progress, ...(expect ? { expect } : {}) });

/** The two small starters WalkMyCode writes itself. */
export function writeStarter(parent: string, name: string, kind: string, say: (t: string) => void): void {
  const root = join(parent, name);
  mkdirSync(root, { recursive: false });
  const files: Record<string, string> =
    kind === "fastapi"
      ? {
          "main.py": `from fastapi import FastAPI\n\napp = FastAPI(title="${name}")\n\n\n@app.get("/")\ndef home():\n    return {"hello": "${name}"}\n`,
          "requirements.txt": "fastapi\nuvicorn[standard]\n",
          ".gitignore": ".venv/\n__pycache__/\n.env\n",
          "README.md": `# ${name}\n\nRun it: \`.venv/Scripts/uvicorn main:app --reload\` (Windows) or \`.venv/bin/uvicorn main:app --reload\`.\n`,
        }
      : {
          "package.json": JSON.stringify({ name: name.toLowerCase(), private: true, type: "module", scripts: { start: "node index.js", dev: "node --watch index.js" }, dependencies: { express: "^4.21.0" } }, null, 2) + "\n",
          "index.js": `import express from "express";\n\nconst app = express();\nconst port = process.env.PORT ?? 3000;\n\napp.get("/", (_req, res) => res.json({ hello: "${name}" }));\n\napp.listen(port, () => console.log(\`${name} on http://localhost:\${port}\`));\n`,
          ".gitignore": "node_modules/\n.env\n",
          ".env.example": "PORT=3000\n",
        };
  for (const [f, text] of Object.entries(files)) {
    writeFileSync(join(root, f), text, { flag: "wx" });
    say(`+ ${name}/${f}\n`);
  }
}
