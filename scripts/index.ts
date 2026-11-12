// Index a folder, or several that make one system, from the command line:
//   npm run index -- <dir> [<dir>...] [--name <name>] [--assume SETTING=service|ADDRESS=service ...] [--forget]
// One folder: its paths as they are (the older `npm run index -- <dir> <name>`
// still works). Several: each folder's paths start with its name, and --name
// is required. Writes .walkmycode/<name>.map.json and .walkmycode/<name>.files.json,
// which the dev server serves as the demo repo. Nothing leaves the machine.
//
// "Where does this point?" (docs/SERVICES.md §13): `--assume VITE_API_URL=backend`
// tells WalkMyCode which service a setting with no value points at (`=elsewhere`: a
// separate backend not in these folders; `=outside`: another company, or not
// sure; `--assume X=` takes an answer back). "Whose address is this?": a key
// with a dot is a public address the code calls, `--assume api.example.com=backend`
// says it is that app (`=outside`: another company's, or not sure). Answers
// already in .walkmycode/<name>.map.json are kept on a re-index unless --forget is given.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { buildMap, hostKey } from "../src/analyzer/build";
import { redactSource } from "../src/analyzer/config/files";
import { serviceId, upgradeMap } from "../src/analyzer/migrate";
import { GRAMMAR_FILES, setGrammarLoader } from "../src/analyzer/parser";
import { combineRepos, uniqueLabels } from "../src/lib/workspace";
import type { Assertion } from "../src/analyzer/types";
import { dataDirIn } from "../src/lib/dataDir";
import { readDir } from "./readDir";

// In Node the grammars are read straight out of node_modules.
setGrammarLoader(async (name) => new Uint8Array(await readFile(join(process.cwd(), "node_modules", GRAMMAR_FILES[name]))));

/** An env name that holds another service's address (docs/SERVICES.md §5 name heuristic). */
const URL_SETTING = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)?([A-Z0-9]+?)_(?:SERVICE_|SVC_)?(?:URL|HOST|BASE_URL|BASEURL|ENDPOINT|API_URL|API|ADDR)$/;

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function parseArgs(argv: string[]): Promise<{ dirs: string[]; name?: string; assume: Map<string, string>; forget: boolean }> {
  const dirs: string[] = [];
  let name: string | undefined;
  const assume = new Map<string, string>();
  let forget = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") name = argv[++i];
    else if (a.startsWith("--name=")) name = a.slice("--name=".length);
    else if (a === "--assume" || a.startsWith("--assume=")) {
      const pair = a === "--assume" ? (argv[++i] ?? "") : a.slice("--assume=".length);
      // SETTING=service, or ADDRESS=service: a key with a dot is an address (https:// and a path are dropped).
      const cut = pair.lastIndexOf("=");
      const key = cut > 0 ? pair.slice(0, cut).trim() : "";
      const setting = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
      const address = key.includes(".") ? hostKey(key) : "";
      if (!setting && !/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(address)) throw new Error(`--assume wants SETTING=service or ADDRESS=service, e.g. --assume VITE_API_URL=backend or --assume api.example.com=backend (got "${pair}")`);
      assume.set(setting ? key : address, pair.slice(cut + 1).trim());
    } else if (a === "--forget") forget = true;
    else dirs.push(a);
  }
  // The older form, `<dir> <name>`: a second word that is not a folder is the name.
  if (!name && dirs.length === 2 && !(await isDir(resolve(dirs[1])))) name = dirs.pop();
  return { dirs: dirs.length ? dirs : ["."], name, assume, forget };
}

/** The answers a previous index of this name was built with, from its saved map: about settings, and about addresses. */
async function savedAnswers(path: string): Promise<Assertion[]> {
  try {
    const prev = JSON.parse(await readFile(path, "utf8")) as { unresolvedBases?: { answer?: Assertion }[]; publicHosts?: { answer?: Assertion }[] };
    return [...(prev.unresolvedBases ?? []), ...(prev.publicHosts ?? [])].flatMap((b) => (b.answer ? [b.answer] : []));
  } catch {
    return [];
  }
}

async function main() {
  const args = await parseArgs(process.argv.slice(2));
  const dirs = args.dirs.map((d) => resolve(d));
  for (const d of dirs) if (!(await isDir(d))) throw new Error(`${d} is not a folder`);
  if (dirs.length > 1 && !args.name) throw new Error("Several folders make one workspace: name it with --name <name>");
  const name = args.name ?? basename(dirs[0]);
  const labels = dirs.length > 1 ? uniqueLabels(dirs.map((d) => basename(d))) : [name];
  const read = await Promise.all(dirs.map(async (d, i) => ({ label: labels[i], files: await readDir(d), kind: "cli" as const })));
  for (const [i, r] of read.entries()) console.log(`${r.files.length} files read from ${dirs[i]}${dirs.length > 1 ? ` (as ${r.label}/)` : ""}`);
  const { sources, repos } = combineRepos(read);
  if (dirs.length === 1) repos[0].label = name;
  const outDir = dataDirIn(resolve("."));
  // Answers from the last index of this name, then the ones given now (an empty one takes an answer back).
  const now = new Date().toISOString();
  const answers = new Map((args.forget ? [] : await savedAnswers(join(outDir, `${name}.map.json`))).map((a) => [a.setting, a]));
  // A service's name or id; "elsewhere" for a separate backend not in these folders; "outside" for another company / not sure.
  for (const [setting, service] of args.assume) {
    const host = setting.includes(".");
    if (host && service === "elsewhere") throw new Error(`--assume ${setting}=elsewhere: an address is an app in these folders (by name or id), or "outside"`);
    if (!service) answers.delete(setting);
    else answers.set(setting, { setting, ...(host ? { host: setting } : {}), service: service === "outside" ? null : service === "elsewhere" ? serviceId(setting) : service, answeredAt: now });
  }
  let last = "";
  const built = await buildMap(sources, {
    name,
    repos,
    assertions: [...answers.values()],
    onProgress: (done, total, file) => {
      if (done % 50 === 0) {
        last = file;
        process.stdout.write(`  parsed ${done}/${total} ${last}\n`);
      }
    },
  });
  // Always write the current map version, whatever the analyzer handed back.
  const map = upgradeMap(built.map, "cli");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${name}.map.json`), JSON.stringify(map));
  // Everything read except secrets, manifests included, so "re-map in browser"
  // sees exactly what a picked folder would.
  const secret = new Set(map.files.filter((f) => f.skipped === "secret").map((f) => f.path));
  // Config files are written with their secrets hidden (.env.example values, URL passwords).
  const contents = Object.fromEntries(sources.filter((s) => !secret.has(s.path)).map((s) => [s.path, redactSource(s.path, s.content)]));
  await writeFile(join(outDir, `${name}.files.json`), JSON.stringify(contents));
  console.log(JSON.stringify(map.stats));
  if (map.repos.length > 1) console.log("repos:", map.repos.map((r) => r.label).join(", "));
  console.log("areas:", map.areas.join(", "));
  const apps = map.services.filter((s) => s.kind === "app");
  const infra = map.services.filter((s) => s.kind !== "app");
  const guesses = map.system.links.filter((l) => l.confidence === "likely").length;
  console.log(
    `system: ${map.system.kind} (${apps.map((s) => s.name).join(", ")})` +
      (infra.length ? ` + ${infra.map((s) => `${s.name} [${s.kind}]`).join(", ")}` : "") +
      ` · ${map.system.links.length} links (${guesses} ${guesses === 1 ? "guess" : "guesses"})`,
  );
  // Settings the code reads to find another service, with no value in any config file.
  const known = new Set(map.services.flatMap((s) => Object.keys(s.env)));
  const unresolved = new Map<string, string>();
  for (const [p, f] of Object.entries(built.facts)) {
    for (const r of f.envReads) if (URL_SETTING.test(r.name) && !known.has(r.name) && !unresolved.has(r.name)) unresolved.set(r.name, `${p}:${r.line}`);
  }
  if (unresolved.size) console.log(`env settings with no value in config: ${[...unresolved].slice(0, 12).map(([n, at]) => `${n} (${at})`).join(", ")}${unresolved.size > 12 ? ` and ${unresolved.size - 12} more` : ""}`);
  // Where does this point? The settings requests are built on, and what you told WalkMyCode about them.
  const svcName = (id: string | null) => (id ? (map.services.find((s) => s.id === id)?.name ?? id) : "an outside service / not sure");
  for (const b of map.unresolvedBases ?? []) {
    const who = b.services.map((id) => svcName(id)).join(", ") || "code in no service";
    const at = b.reads[0] ? ` (${b.reads[0].file}:${b.reads[0].line})` : "";
    const target = b.answer?.service === b.placeholder ? "a separate backend whose code isn't here" : svcName(b.answer?.service ?? null);
    const told = b.answer ? ` · you told WalkMyCode: ${b.setting} → ${target}` : ` · answer with --assume ${b.setting}=<service|elsewhere|outside>`;
    console.log(`no value for ${b.setting}${at}: ${b.calls} ${b.calls === 1 ? "request" : "requests"} from ${who} built on it (${b.links} ${b.links === 1 ? "arrow" : "arrows"})${told}`);
  }
  // Whose address is this? Public addresses the code calls, what the repos' deploy config says, and what you told WalkMyCode.
  for (const h of map.publicHosts ?? []) {
    if (!h.guess && !h.config && !h.answer) continue; // another company's API, most likely: nothing to ask
    const who = h.services.map((id) => svcName(id)).join(", ") || "code in no service";
    const match = h.guess ? `; ${h.matches[h.guess]} match ${svcName(h.guess)}'s routes` : "";
    const cfg = h.config ? ` · ${h.config.evidence.file}:${h.config.evidence.line} says it is ${svcName(h.config.service)}` : "";
    const told = h.answer ? ` · you told WalkMyCode: ${h.answer.service ? svcName(h.answer.service) : "another company's service / not sure"}` : h.config ? "" : ` · answer with --assume ${h.host}=<service|outside>`;
    console.log(`address ${h.origin}: ${h.calls} ${h.calls === 1 ? "request" : "requests"} from ${who}${match} (${h.links} ${h.links === 1 ? "arrow" : "arrows"})${cfg}${told}`);
  }
  for (const a of answers.values()) {
    if (a.host) {
      if (!(map.publicHosts ?? []).some((h) => h.host === a.host)) console.log(`not used: you told WalkMyCode about ${a.host}, but no request goes to it`);
    } else if (!(map.unresolvedBases ?? []).some((b) => b.setting === a.setting)) console.log(`not used: you told WalkMyCode about ${a.setting}, but no request is built on it with no value`);
  }
  const byKind: Record<string, number> = {};
  for (const e of map.edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log("edges by kind:", byKind);
  const byLayer: Record<string, number> = {};
  for (const n of map.nodes) byLayer[n.layer] = (byLayer[n.layer] ?? 0) + 1;
  console.log("nodes by layer:", byLayer);
  for (const w of map.warnings.slice(0, 12)) console.log("warning:", w);
  console.log(`written to ${outDir}/${name}.map.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
