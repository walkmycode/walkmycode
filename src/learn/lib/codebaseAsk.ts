/**
 * What a lesson request from the Learn home asks for beyond its subject: a
 * codebase on this computer to teach it from ("…in my kola v2 codebase"),
 * and diagrams by name ("use UML", "a sequence diagram"). Pure, so the page,
 * the server (src/lib/learnCodebase.ts reads the folder) and the tests share it.
 *
 * The owner (15 Nov) asked for "how payment gateway in fintech work, especially
 * in kola 'codebase in myenvironment … v2'" drawn in UML, and got a tuck shop
 * in Leeds over made-up Python. A request that names a codebase is now taught
 * from that codebase's real files, or says plainly that it was not found; one
 * that names diagrams gets them.
 */
import type { Lesson } from "./types";

/* ── Diagrams asked for by name ── */

export type DiagramKind = "sequence" | "class" | "state" | "er" | "flowchart" | "activity" | "component" | "usecase" | "mindmap";
export type DiagramAsk = { uml: boolean; kinds: DiagramKind[] };

const KIND_RES: [DiagramKind, RegExp][] = [
  ["sequence", /\bsequence\s*(diagram|chart)s?\b|\bswim\s*lanes?\b/],
  ["class", /\bclass\s*diagrams?\b/],
  ["state", /\bstate\s*(diagram|machine|chart)s?\b|\bstatecharts?\b/],
  ["er", /\b(er|erd|entity[\s-]*relationship)\s*(diagram|model)?s?\b/],
  ["activity", /\bactivity\s*diagrams?\b/],
  ["component", /\b(component|architecture|deployment)\s*diagrams?\b/],
  ["usecase", /\buse[\s-]*case\s*diagrams?\b/],
  ["flowchart", /\bflow\s*-?\s*(chart|diagram)s?\b/],
  ["mindmap", /\bmind\s*-?\s*maps?\b/],
];

/** The diagrams a request names, or null when it names none. "UML" alone means a sequence diagram of the
 *  flow and a class diagram of the types: the two UML diagrams a flow through code is explained with. */
export function diagramsAsked(text: string): DiagramAsk | null {
  const t = text.toLowerCase();
  const uml = /\buml\b/.test(t);
  const kinds = KIND_RES.filter(([, re]) => re.test(t)).map(([k]) => k);
  const generic = /\b(diagram|diagrams|diagrammed|diagramming|draw|drawn|visuali[sz]e|chart)\b/.test(t);
  if (!uml && !kinds.length && !generic) return null;
  return { uml, kinds: kinds.length ? kinds : uml ? ["sequence", "class"] : [] };
}

/** How each kind is written in Mermaid, the language the boards draw (src/learn/components/Diagram.tsx). */
export const MERMAID: Record<DiagramKind, string> = {
  sequence: "sequenceDiagram: a participant for each part that talks (the person, a page or component, a hook or service, an API client, the server, an outside provider), in the order they first speak; ->> for a call or request, -->> for its reply, named as in the code (createPayment(amount), POST /payments); alt/else for success and failure, loop for retries or polling, Note over for what a step means",
  class: "classDiagram: the real types (classes, interfaces, type aliases, enums, protobuf messages) with their real fields as name: type and methods as name(), written inside braces, one member per line (class PayoutPayload {\\n  amount: number\\n}), never as PayoutPayload : amount: number, which Mermaid cannot read; a union or enum's values as members under <<enumeration>>; UML relations between them: <|-- inherits, *-- is made of, o-- has, --> uses, ..> depends on, with multiplicities (\"1\" --> \"*\") where the code shows them",
  state: "stateDiagram-v2: the real states (as the code names them: a status enum or field) and the transitions between them, each labelled with what causes it; [*] for the start and the end",
  er: "erDiagram: the real entities and their fields, and the relations between them with crow's-foot cardinalities (||--o{)",
  flowchart: "flowchart TD: the real steps in order, a diamond {…} for each decision with its yes/no edges",
  activity: "an activity diagram, drawn as flowchart TD: a rounded start and end ([…]), the real actions in order, diamonds {…} for decisions, subgraphs for who does each part",
  component: "a component diagram, drawn as flowchart LR: a subgraph per component or layer (page, state store, API client, server, outside provider) and labelled arrows for what flows between them",
  usecase: "a use case diagram, drawn as flowchart LR: the actors on the left, each use case as a stadium ([…]) inside a subgraph for the system, an arrow from each actor to what they do",
  mindmap: "mindmap: the idea at the root, its parts as branches",
};

/** The rules for the diagrams the student asked for, added to the lesson's prompt. `grounded`: taught from a codebase. */
export function diagramPromptPart(ask: DiagramAsk, grounded: boolean, talkBoards: number): string {
  const what = ask.uml ? "UML diagrams" : "diagrams";
  const need = Math.max(ask.kinds.length, Math.min(talkBoards, Math.ceil(talkBoards / 2)));
  const real = grounded ? "the codebase's real parts and names (files, components, hooks, functions, types, endpoints), exactly as the codebase's files above show them" : "the real parts and names of the subject, never the analogy's";
  return `THE STUDENT ASKED FOR ${what.toUpperCase()}${ask.kinds.length ? ` (${ask.kinds.map((k) => (k === "er" ? "ER" : k === "usecase" ? "use case" : k)).join(", ")})` : ""}. They are what was asked for, not decoration, so they are required:
- At least ${need} of the talk boards carry a "diagram" (one per board)${ask.kinds.length ? `, and together they include ${ask.kinds.map((k) => `a ${MERMAID[k].split(":")[0]}`).join(" and ")}` : ", each of the kind that fits its idea best (a sequenceDiagram for a flow over time, a classDiagram for types, a stateDiagram-v2 for a status that changes, a flowchart for steps and decisions)"}.
${ask.kinds.map((k) => `- ${MERMAID[k]}.`).join("\n")}
- Every participant, message, class, field and state in a diagram is one of ${real}. The diagram is the real mechanism: its labels are the real names. The analogy's words may be a box's short second line (after <br/>), never instead of the real name.
- ${ask.uml ? "Follow UML's notation as Mermaid writes it, so the student learns to read real UML. " : ""}Up to 14 nodes or participants for these diagrams; short plain labels; no styling.
- The board's lines and what you say aloud walk through the diagram: name each step or part in order, so the student can follow it on the picture.
- Analogies still come first on each board, as everywhere in this lesson; the diagram then shows the real thing the analogy stands for.`;
}

/* ── A codebase named in the request ── */

export type CodebaseAsk = {
  /** Absolute paths the request contains (checked on the server: the longest part that is a folder). */
  paths: string[];
  /** The request's words that may name the folder, lower case. */
  words: string[];
  /** The words around "codebase", for saying what was looked for. */
  phrase: string;
};

const STOP = new Set(
  "a an the and or but of in on at to for from with by into onto about as is are was were be been being it its this that these those my our your their me we you i he she they them his her how what why when where which who whom do does did done can could would should will shall may might must have has had use using used describe described explain explained show shown teach tell learn learning understand understanding work works working especially specially particularly like please want need help make made write drawn draw lesson lessons course handle handles handled happen happens".split(
    " ",
  ),
);
const CUE_WORDS = new Set(["codebase", "codebases", "code", "base", "repo", "repos", "repository", "repositories", "project", "projects", "folder", "folders", "directory", "app", "source", "pc", "computer", "laptop", "machine", "files", "file"]);
const DIAGRAM_WORDS = new Set(["uml", "diagram", "diagrams", "sequence", "class", "classes", "state", "flowchart", "flow", "chart", "er", "erd", "activity", "component", "mindmap", "mind", "map", "visualise", "visualize"]);
/** Words that say a codebase on this computer is meant. */
const STRONG_CUE = /\b(code\s?bases?|repos?|repositor(y|ies)|(my|our)\s+(own\s+)?(code|project|projects|app|folder|source)|(on|in)\s+(this|my)\s+(pc|computer|laptop|machine))\b/i;

/** Absolute paths in a request: C:\…, ~/…, /home/…, /Users/… Cut at a quote or the end of the line; the
 *  server keeps the longest part of each that is a real folder, so a path followed by more words still works. */
export function pathsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s"'“‘(`])([A-Za-z]:[\\/][^\n"'“”‘’`<>|?*]*|~[\\/][^\n"'“”‘’`<>|?*]*|\/(?:home|Users|mnt|srv|opt|workspace|workspaces|projects|code|src)\/[^\n"'“”‘’`<>|?*]*)/g)) {
    const p = m[1].replace(/[\s.,;:!)]+$/, "");
    if (p.length > 3) out.push(p);
  }
  return out;
}

/** Lower-case words: a request's, or a folder name's split at -, _, ., spaces and camelCase ("KolaWebV2" → kola web v2). */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does the request name a codebase on this computer, and with which words? Null when it does not: a request
 *  that only mentions "project management" or "a folder" is a subject, not a place on the disk. */
export function codebaseAsked(text: string): CodebaseAsk | null {
  const paths = pathsIn(text);
  if (!paths.length && !STRONG_CUE.test(text)) return null;
  const all = wordsOf(text.replace(/[A-Za-z]:[\\/]/g, " "));
  const words = [...new Set(all.filter((w) => !STOP.has(w) && !CUE_WORDS.has(w) && !DIAGRAM_WORDS.has(w) && (w.length > 1 || /\d/.test(w))))];
  // What was asked for, in the request's own words: the word or two before "codebase" and what follows it.
  const cue = all.findIndex((w, i) => /^(codebases?|repos?|repositor(y|ies)|project|app|folder|source)$/.test(w) || (w === "base" && all[i - 1] === "code") || (w === "code" && all[i + 1] !== "base"));
  const around: string[] = [];
  if (cue >= 0) {
    for (let i = cue - 1; i >= 0 && around.length < 2 && !STOP.has(all[i]); i--) if (!CUE_WORDS.has(all[i])) around.unshift(all[i]);
    const after = all.slice(cue + 1).filter((w) => !STOP.has(w) && !CUE_WORDS.has(w) && !DIAGRAM_WORDS.has(w));
    around.push(...after.slice(0, 3));
  }
  const phrase = paths[0] ?? (around.length ? around.join(" ") : words.slice(0, 4).join(" "));
  return { paths, words, phrase };
}

/** Folder-name words that say little on their own: a match on these alone is not a match. */
const COMMON = new Set(
  "app apps web api apis portal business demo test tests src code project projects new old main my frontend backend server client service services site website nextjs next react vue angular node js ts python rust go java dotnet csharp lib libs core ui admin dashboard mobile desktop docs doc example examples sample samples starter template basics learning tutorial playground copy backup final".split(" "),
);
const versionLike = (w: string) => /^v?\d+$/.test(w);
const same = (a: string, b: string) => a === b || (a.length > 3 && (a === `${b}s` || b === `${a}s`));

/**
 * How well a folder's name matches the request's words: 3 for each distinctive word of the name found in the
 * request, 1 for a common one or a version ("v2"), less a little for each name word the request did not say, so
 * "kola-merchant-portal-v2" beats "KOLA-MERCHANT-PORTAL-NEXTJS" for "kola … v2". 0 when no
 * distinctive word matched.
 */
export function scoreFolder(requestWords: string[], name: string): number {
  const mine = wordsOf(name);
  if (!mine.length) return 0;
  let score = 0;
  let distinctive = false;
  for (const w of mine) {
    const hit = requestWords.some((r) => same(r, w));
    if (!hit) score -= 0.1;
    else if (COMMON.has(w) || versionLike(w)) score += 1;
    else {
      score += 3;
      distinctive = true;
    }
  }
  return distinctive ? Math.round(score * 10) / 10 : 0;
}

export type Candidate = { name: string; path: string };

/** The folder the request names, and the next best (said when nothing matched well enough, or to choose between). */
export function pickCodebase(words: string[], candidates: Candidate[]): { best: Candidate | null; near: Candidate[] } {
  const scored = candidates
    .map((c) => ({ c, s: scoreFolder(words, c.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.length - b.c.name.length);
  return { best: scored[0]?.c ?? null, near: scored.slice(1, 4).map((x) => x.c) };
}

/** The words of the subject itself, for finding the files that matter: the request less the codebase's name,
 *  the places, the asks for diagrams and the little words. */
export function topicTerms(text: string, notThese: string[] = []): string[] {
  const drop = new Set(notThese.flatMap(wordsOf));
  return [...new Set(wordsOf(text.replace(/[A-Za-z]:[\\/][^\s]*/g, " ")).filter((w) => w.length > 2 && !STOP.has(w) && !CUE_WORDS.has(w) && !DIAGRAM_WORDS.has(w) && !drop.has(w) && !versionLike(w)))];
}

/* ── What the server read, and how the professor is told ── */

export type CodebaseFile = { path: string; content: string; from: number; to: number; lines: number };
export type CodebaseDigest = {
  name: string;
  path: string;
  /** Code files in the folder (what the reader kept). */
  files: number;
  /** "src/components/Merchant-collect (12)": the folders that matter most, with how many files each holds. */
  folders: string[];
  /** The files that matter most for the subject, with line numbers, cut to fit. */
  picked: CodebaseFile[];
  /** The words they were picked by. */
  terms: string[];
};
export type CodebaseMissing = { phrase: string; looked: string[]; near: string[]; why?: string };
export type CodebaseLookup = { asked: false } | { found: CodebaseDigest } | { missing: CodebaseMissing };

const numbered = (f: CodebaseFile) =>
  f.content
    .split("\n")
    .map((l, i) => `${f.from + i}| ${l}`)
    .join("\n");

/** The lesson grounded in a codebase: what the professor is told, and the files themselves. */
export function codebasePromptPart(d: CodebaseDigest): string {
  return `THE STUDENT'S OWN CODEBASE. The student asked for this lesson to be taught from their real project "${d.name}" (${d.path}, ${d.files} code files), and it was found on their computer. The parts of it that matter for this subject are below, read from disk just now (secrets are never read). This overrides the general rules above where they differ:
- Teach the subject through THIS code. The worked example that runs through the lesson is this codebase's real flow, not a made-up one: real file paths, components, hooks, functions, types, API calls and endpoints, as they are written here.
- Never invent code, names or behaviour these files do not show. When a step happens somewhere this code only calls (a backend service, a payment provider), say so plainly and name what the code calls and with what.
- Name where things are, as \`file:line\` in the chalk or the file's name aloud, so the student can open it.
- The first board says this lesson is about ${d.name} and gives the big picture of the flow in it. The last talk board recaps the flow with the real names.
- The analogy on each board still comes first, but it pictures this code's flow, and the board then shows the real thing.
- Quiz and explain-back questions are about this code: which file does what, what is called next, what a type holds.
- A "code" board, if there is one, has the student re-create a small piece of the real logic in TypeScript (the editor runs TypeScript in the page: no npm packages, no network, no React), with the real names, and the task says which file it mirrors.

Folders that matter (files in each): ${d.folders.join("; ") || "(none listed)"}

${d.picked.map((f) => `=== ${f.path} (lines ${f.from}-${f.to} of ${f.lines}) ===\n${numbered(f)}`).join("\n\n")}

=== end of the codebase ===`;
}

/** The lesson asked for from a codebase that was not found: it says so, and never passes off made-up code as the student's. */
export function missingCodebasePart(m: CodebaseMissing): string {
  return `THE CODEBASE WAS NOT FOUND. The student asked for this lesson to use their own codebase ("${m.phrase}"), but ${m.why ?? "no folder on their computer matched it"}${m.looked.length ? ` (looked in: ${m.looked.join("; ")})` : ""}${m.near.length ? `; the closest folders were ${m.near.join(", ")}, not close enough to be sure` : ""}. So:
- The first line of the first board says so plainly, in chalk and aloud: "${m.phrase}" was not found on this computer, so this lesson uses a general example. Aloud, tell them how to get the real thing: on the Learn home, "Learn from my own code" opens their project in Explore, where "Teach me this" on any file teaches from the real code.
- Never present the example as their code, and never invent file names, classes or functions and call them theirs.`;
}

/** What the lesson's prompt gets from the request: the codebase (or that it was not found), then the diagrams. */
export function groundingPart(lookup: CodebaseLookup | null, diagrams: DiagramAsk | null, talkBoards: number): string {
  const parts: string[] = [];
  if (lookup && "found" in lookup) parts.push(codebasePromptPart(lookup.found));
  if (lookup && "missing" in lookup) parts.push(missingCodebasePart(lookup.missing));
  if (diagrams) parts.push(diagramPromptPart(diagrams, !!lookup && "found" in lookup, talkBoards));
  return parts.join("\n\n");
}

/** What a lesson keeps of its grounding (types.ts, Lesson.ground), for its scenes and its top bar. */
export function groundOf(lookup: CodebaseLookup | null, diagrams: DiagramAsk | null): Lesson["ground"] {
  const codebase = lookup && "found" in lookup ? { name: lookup.found.name, path: lookup.found.path } : undefined;
  const missing = lookup && "missing" in lookup ? lookup.missing.phrase : undefined;
  if (!codebase && !missing && !diagrams) return undefined;
  return { ...(codebase ? { codebase } : {}), ...(missing ? { missing } : {}), ...(diagrams ? { diagrams: diagrams.kinds, uml: diagrams.uml } : {}) };
}

/** A line for the "Watch it happen" scene of a grounded lesson (src/learn/lib/scene.ts): real names on the real side,
 *  and the diagram kind the student asked for. Empty for every other lesson. */
export function sceneGrounding(lesson: Lesson): string {
  const g = lesson.ground;
  if (!g) return "";
  const out: string[] = [];
  if (g.codebase) out.push(`This lesson is taught from the student's own codebase, ${g.codebase.name}: the real side of the scene uses the real names and code on the board (its files, components, functions and types), never made-up code.`);
  if (g.diagrams?.includes("sequence")) out.push("The student asked for a sequence diagram: a sequence scene suits a flow of calls best.");
  else if (g.diagrams?.some((k) => k === "class" || k === "state" || k === "er" || k === "flowchart" || k === "activity")) out.push(`The student asked for ${g.uml ? "UML" : "diagrams"} (${g.diagrams.join(", ")}): a graph scene of that kind suits this lesson best.`);
  return out.length ? `${out.join(" ")}\n` : "";
}
