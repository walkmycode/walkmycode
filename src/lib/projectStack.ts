// What a workspace is built with, in two or three words ("Laravel · PHP",
// "Next.js · FastAPI"), for the top bar and the guide's welcome; and what
// WalkMyCode itself made ("New project", src/ide/localrun/setup), remembered in
// this browser so the guide can greet a project it just made as that project.
import type { CodeMap } from "@/analyzer/types";

export interface MadeNote {
  starter: string;
  /** "Laravel", "Next.js". */
  label: string;
  language: string;
  /** ISO time it was made. */
  at: string;
  /** What the user said it should do ("What should it do?" on the form): the guide offers to build it first. */
  brief?: string;
}

const KEY = (name: string) => `walkmycode.made.${name}`;

/** The language each starter is written in. */
export const STARTER_LANGUAGE: Record<string, string> = { laravel: "PHP", next: "TypeScript", "vite-react": "TypeScript", fastapi: "Python", express: "JavaScript" };

export function madeNote(name: string | undefined): MadeNote | null {
  if (!name) return null;
  try {
    const raw = localStorage.getItem(KEY(name));
    return raw ? (JSON.parse(raw) as MadeNote) : null;
  } catch {
    return null;
  }
}

export function saveMade(name: string, note: MadeNote): void {
  try {
    localStorage.setItem(KEY(name), JSON.stringify(note));
  } catch {
    // private window: the guide greets it generically
  }
}

/**
 * The stack, most telling first, at most three words: what WalkMyCode made it
 * as; else the setup check's stacks ("Laravel · PHP", "Vite · npm": package
 * managers left out); else the frameworks the map found on its apps.
 */
export function stackOf(map: CodeMap | null, setupStacks: string[], made: MadeNote | null): string[] {
  const out: string[] = [];
  const add = (w: string | undefined) => {
    const v = w?.trim();
    if (v && !out.includes(v) && !/^(npm|pnpm|yarn|bun|Composer|Cargo|Bundler|new)$/i.test(v)) out.push(v);
  };
  if (made) {
    add(made.label);
    add(made.language);
  }
  for (const s of setupStacks) for (const w of s.split("·")) add(w);
  for (const svc of map?.services ?? []) if (svc.kind === "app") add(svc.framework);
  return out.slice(0, 3);
}
