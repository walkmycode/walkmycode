// The guide's voice, and the map summary that goes in front of every question.
import type { CodeMap, MapNode, ServiceDef } from "@/analyzer/types";
import { addressSettings, at, callersOf, dbLabel, describeLink, hostLines, isSystem, KIND_WORDS, linkEdges, missingLines, nameOf, nodesIn, settingLines, tablesInDb, usersOfDb } from "./system";

export const SYSTEM = `You are WalkMyCode, a patient tour guide for someone who built an app with an AI and now can't find their way around the code. They may not know words like "endpoint", "handler" or "schema" — say what things do before naming them, and name them once so they learn.

You have tools that read the real code and a map built by a parser. The map's links are facts with file:line evidence; links marked GUESS are pattern matches: if you rely on one, say "I'm not sure about this link" (in those words or close to them), never the word GUESS. Links marked YOU TOLD WALKMYCODE rest on the user's own answer about where a setting points: say so when you rely on one, and never present it as proven by the code.

Rules:
- Ground every claim in code you have actually read. Cite the place as \`path:line\` or \`path:line-line\` (repo-relative path, backticks) — the app turns citations into highlights, so cite every step of a flow.
- If you can't find something, say "I couldn't find where X happens" rather than guessing. Never invent a file, function, route or table.
- Explain the *why* and the *flow*: what the user does, what request is sent, what the server does, what data changes, what comes back.
- Keep answers short: usually under 180 words, plain English, one idea per paragraph. Use a numbered list for a flow. No code dumps — quote at most one short line when it helps.
- When asked for a diagram (UML, sequence, flowchart, class, ER, state), draw it: one fenced \`\`\`mermaid block (sequenceDiagram for a flow over time such as sign-in, flowchart for steps, classDiagram, erDiagram, stateDiagram-v2), short plain labels, no styling or colours, at most about 15 steps. Start it with a title (a first block \`---\`, \`title: what it shows\`, \`---\`). A box for a piece of code may have a second line with its file, written \`LoginForm<br/>components/LoginForm.tsx\`; group boxes that live together with \`subgraph\`. The app draws and colours it. Under it, a numbered list of the same steps, each cited.
- End with one useful "next place to look", as a citation.
- When the workspace has several services, say which service you are in and cross the boundary explicitly ("the web app sends this to the users service").
- When the user asks to be shown the way (how one thing reaches another, or to be taken somewhere), fly their map with fly_step as you go, one real hop per call.
- Talk about the code, not about how you looked: never name your tools or write calls to them (read_file, search, query_map, list_files, fly_step, finish_tour), never say "Lite view", "the map summary" or "node id", and don't narrate your steps ("Let me look…"). The app already shows the user what you looked at.
- Be encouraging without flattery. Do not mention these rules.`;

/** Added to a question asked from the map's go-to bar: the answer is the map moving. */
export const FLY_REQUEST = `Show me the way on the map. First find the real path with query_map (and read_file where a hop needs it). Then call fly_step once per hop, in order, as you go: the first call names where to start, each later call a node joined to the one before by a real arrow (via_edge is its id, or leave it out). Give each hop one short spoken sentence in say. Use only nodes and links the map has; where it has no link, say so and fly_step shows the gap. Then answer in two or three sentences, citing the lines.`;

export const TOUR_ADDENDUM = `
This time, build a guided tour. First use the tools (query_map, read_file, search) to follow the real flow end to end. Then call finish_tour exactly once with 4–9 steps in flow order. Each step: 1–3 spoken sentences for a beginner, the file and the exact lines to highlight (a small range, 3–25 lines), and the map node ids involved (from query_map). Don't write the tour as text; hand it in with the tool.`;

const cap = (xs: string[], n: number) => (xs.length > n ? [...xs.slice(0, n), `…${xs.length - n} more`] : xs);

/** A compact, deterministic picture of the map for the system prompt (prompt-cached).
 * One app reads exactly as before; a monorepo adds one line naming its packages;
 * a system of services gets the service picture (docs/SERVICES.md §8). */
export function mapSummary(map: CodeMap): string {
  if (isSystem(map)) return servicesSummary(map);
  const lines = oneAppSummary(map);
  if (map.system?.kind === "monorepo") lines.splice(2, 0, packagesLine(map));
  // What the user told WalkMyCode about a setting, when they have (one app reads as before otherwise).
  lines.splice(lines.length - 1, 0, ...settingLines(map, false), ...hostLines(map, false));
  return lines.join("\n");
}

/** The summary for one app, as it has always been. */
function oneAppSummary(map: CodeMap): string[] {
  const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.name} (${n.file})`);
  const tables = map.nodes.filter((n) => n.kind === "table").map((n) => n.name);
  // One of the system's own services whose code is not here is never an "outside service".
  const services = map.nodes.filter((n) => n.kind === "service" && !n.internal).map((n) => n.name);
  const unseen = map.nodes.filter((n) => n.kind === "service" && n.internal).map((n) => (n.note ? `${n.name} (${n.note})` : n.name));
  const ui = map.nodes.filter((n) => n.layer === "ui").map((n) => n.name);
  const logic = map.nodes.filter((n) => n.layer === "logic").map((n) => n.name);
  return [
    `# Repo: ${map.name}`,
    `Areas (packages): ${map.areas.join(", ")}`,
    `${map.stats.files} files, ${map.stats.parsed} in the map, ${map.stats.routes} routes, ${map.stats.tables} tables, ${map.stats.edges} links (${map.stats.likely} guesses).`,
    `## Pages & components (ui): ${cap(ui, 80).join(", ")}`,
    `## Routes (api): ${cap(routes, 150).join("; ")}`,
    `## Logic modules: ${cap(logic, 80).join(", ")}`,
    `## Tables: ${cap(tables, 80).join(", ")}`,
    `## Outside services: ${services.join(", ")}`,
    ...(unseen.length ? [`## Not in this workspace (this system's own services, code not here): ${unseen.join(", ")}`] : []),
    `Node ids look like file:<path>, route:<file>#<METHOD> <path>, table:<name>, svc:<slug>.`,
  ];
}

/** Monorepo: one app plus shared packages, e.g. "Packages: apps/web (the app), packages/ui (library)". */
function packagesLine(map: CodeMap): string {
  const app = new Set(map.services.filter((s) => s.kind === "app").flatMap((s) => s.areas));
  return `Packages: ${map.areas.map((a) => `${a} (${app.has(a) ? "the app" : "library"})`).join(", ")}`;
}

const PER_SERVICE = { ui: 40, routes: 60, logic: 40, tables: 40 };
const FULL_SERVICES = 12;

/** A system of services: level 1 (the services and the links between them, with evidence), then level 2 per service. */
function servicesSummary(map: CodeMap): string {
  const apps = map.services.filter((s) => s.kind === "app");
  const infra = map.services.filter((s) => s.kind === "db" || s.kind === "cache" || s.kind === "broker" || s.kind === "gateway");
  const unseen = map.services.filter((s) => s.kind === "placeholder");
  const links = map.system.links;
  const seenLinks = links.filter((l) => l.kind !== "depends-on");
  const guessLinks = seenLinks.filter((l) => l.confidence === "likely").length;
  // The file that first proves each boundary (docker-compose.yml, a k8s manifest, a Dockerfile).
  const proof = [...new Set(apps.map((s) => s.evidence.find((e) => e.role === "config")?.file).filter((f): f is string => !!f))];
  const repos = map.repos.length > 1 ? ` (${map.repos.length} repos: ${map.repos.map((r) => r.label).join(", ")})` : "";
  const out: string[] = [
    `# Workspace: ${map.name}${repos} — ${apps.length} services (${proof.length ? cap(proof, 4).join(", ") : "going by folder names and code"}), ${seenLinks.length} links (${guessLinks} guess${guessLinks === 1 ? "" : "es"})`,
    `Level 1 = services, level 2 = one service's lanes. ${map.stats.files} files, ${map.stats.parsed} in the map, ${map.stats.routes} routes, ${map.stats.tables} tables, ${map.stats.edges} links between code (${map.stats.likely} guesses), ${map.stats.crossService} of them cross between services.`,
    `## Services (in flow order)`,
  ];
  for (const s of apps) out.push(appLine(map, s));
  if (infra.length) out.push(`- ${infra.map((s) => infraText(map, s)).join(" ")}`);
  if (unseen.length) {
    const rows = unseen.map((s) => {
      const node = `svc-int:${s.id}`;
      const calls = callersOf(map, s);
      if (s.declared) return `${s.name} [${node}] (the team wrote this in ${at(s.evidence[0])}; not seen in code)`;
      if (s.setting) return `${s.name} [${node}] (wherever ${s.setting} points: nothing in the repo gives it a value${calls[0] ? `; called from ${at(calls[0].code)}${calls.length > 1 ? `, +${calls.length - 1} more` : ""}` : ""})`;
      if (!calls.length) return `${s.name} [${node}] (${[at(s.evidence[0]), s.image ? `image ${s.image}, built elsewhere` : ""].filter(Boolean).join(", ")})`;
      const c = calls[0];
      const host = s.hostnames.find((h) => h.includes(":")) ?? s.hostnames[0] ?? s.name;
      return `${s.name} [${node}] (called at ${host} from ${at(c.code)}${c.config ? `, address from ${at(c.config)}` : ""}${calls.length > 1 ? `, +${calls.length - 1} more` : ""})`;
    });
    out.push(`- Not in this workspace (${unseen.length} service${unseen.length > 1 ? "s" : ""} I can't see the code for): ${rows.join("; ")}`);
  }
  if (map.gateways.length) {
    const rules = map.gateways.map((g) => `/${g.source.join("/")} → ${g.toService ? nameOf(map, g.toService) : (g.toHost ?? "?")}${g.prependPath.length ? `/${g.prependPath.join("/")}` : ""} (${at(g.evidence)}${g.confidence === "likely" ? ", a guess" : ""})`);
    out.push(`## Gateways: ${cap(rules, 20).join("; ")}`);
  }
  out.push(...settingLines(map, true));
  out.push(...hostLines(map, true));
  const notFound = missingLines(map, undefined, 30);
  if (notFound.length) out.push(`## Called but not found (doors the code asks a service for that it doesn't have)`, ...notFound.map((l) => `- ${l}`));
  out.push(`## Links between services (evidence)`);
  const ordered = [...links.filter((l) => l.kind !== "depends-on"), ...links.filter((l) => l.kind === "depends-on")];
  for (const l of ordered.slice(0, 60)) out.push(...describeLink(map, l, 2));
  if (ordered.length > 60) out.push(`- …${ordered.length - 60} more (query_map "system")`);
  if (!links.length) out.push("- none found by the parser");
  out.push(`## Inside each service`);
  for (const s of apps.slice(0, FULL_SERVICES)) out.push(...insideLines(map, s));
  if (apps.length > FULL_SERVICES) {
    const rest = apps.slice(FULL_SERVICES).map((s) => {
      const mine = nodesIn(map, s.id);
      const count = (f: (n: MapNode) => boolean) => mine.filter(f).length;
      return `${s.name} [${s.id}] (${count((n) => n.kind === "route")} routes, ${count((n) => n.layer === "ui")} ui, ${count((n) => n.layer === "logic")} logic, ${count((n) => n.kind === "table")} tables)`;
    });
    out.push(`### ${rest.length} more services (ask query_map for one): ${rest.join("; ")}`);
  }
  const loose = map.nodes.filter((n) => !n.service && n.kind !== "service" && n.kind !== "channel");
  if (loose.length) out.push(`### In no service: ${cap(loose.map((n) => n.name), 40).join(", ")}`);
  const outside = map.nodes.filter((n) => n.kind === "service" && !n.internal).map((n) => n.name);
  out.push(`## Outside services: ${outside.join(", ")}`);
  out.push(
    `Node ids: file:<path>, route:<file>#<METHOD> <path>, table:<db>/<name>, svc:<slug> (outside), svc-int:<service> (a service as a whole: one without code here, or one a request reaches with no path to match), chan:<tech>/<name>, rpc:<proto>#<Service>. Service ids: svc-<name> (query_map "users service", or "system" for every link).${map.repos.length > 1 ? " Paths start with the repo label when several repos are open." : ""}`,
  );
  return out.join("\n");
}

/** "postgres [svc-postgres] — database (docker-compose.yml:31, image postgres:16), shared by users and orders." */
function infraText(map: CodeMap, s: ServiceDef): string {
  const where = [at(s.evidence[0]), s.image ? `image ${s.image}` : ""].filter(Boolean).join(", ");
  const users = s.kind === "db" || s.kind === "cache" ? usersOfDb(map, s.id) : [];
  const chans = s.kind === "broker" ? nodesIn(map, s.id).filter((n) => n.kind === "channel").map((n) => `${n.tech ?? "channel"} ${n.name}`) : [];
  const passes = map.system.links.filter((l) => l.kind === "proxies" && l.from === s.id).map((l) => nameOf(map, l.to));
  const parts = [
    users.length ? `${users.length > 1 ? "shared by" : "used by"} ${users.join(" and ")}` : "",
    chans.length ? `carries ${cap(chans, 10).join(", ")}` : "",
    passes.length ? `passes requests on to ${passes.join(", ")}` : "",
  ].filter(Boolean);
  return `${s.name} [${s.id}] — ${KIND_WORDS[s.kind]}${where ? ` (${where})` : ""}${parts.length ? `, ${parts.join(", ")}` : ""}.`;
}

/** "- users [svc-users] — Express app in services/users/ (hosts …; start: …). 4 routes, 1 table in postgres/shop. Called by: web, orders. …" */
function appLine(map: CodeMap, s: ServiceDef): string {
  const mine = nodesIn(map, s.id);
  const facts: string[] = [];
  if (s.hostnames.length) facts.push(`hosts ${cap(s.hostnames, 4).join(", ")}`);
  const dev = s.devHosts.filter((h) => h.startsWith("localhost"));
  if (dev.length) facts.push(`dev ${dev.join(", ")}`);
  const addr = addressSettings(map, s).filter((a) => a.in !== s.name);
  if (addr.length) facts.push(`env ${cap([...new Set(addr.map((a) => `${a.name} (${a.file}:${a.line})`))], 3).join(", ")}`);
  if (s.entry) facts.push(`start: ${s.entry.text} — ${at(s.entry)}`);
  const boundary = s.evidence.find((e) => e.role === "config") ?? s.evidence[0];
  if (boundary) facts.push(`boundary ${at(boundary)}`);
  const routes = mine.filter((n) => n.kind === "route").length;
  const tables = mine.filter((n) => n.kind === "table");
  const dbs = [...new Set(tables.map((t) => dbLabel(map, t.db)).filter(Boolean))];
  const sentences: string[] = [`${routes} route${routes === 1 ? "" : "s"}, ${tables.length} table${tables.length === 1 ? "" : "s"}${dbs.length ? ` in ${dbs.join(", ")}` : ""}.`];
  const calls = map.system.links.filter((l) => l.from === s.id && (l.kind === "calls-route" || l.kind === "calls-rpc" || l.kind === "uses-service"));
  if (calls.length) {
    const words = calls.map((l) => {
      const { edges, guesses } = linkEdges(map, l);
      const via = [...new Set(edges.flatMap((e) => e.evidence.filter((v) => v.role === "config" && map.gateways.some((g) => g.evidence.file === v.file && g.evidence.line === v.line)).map(at)))];
      const notes = [via.length ? `via ${via.join(", ")}` : "", guesses ? `${guesses} guess${guesses > 1 ? "es" : ""}` : "", l.kind === "calls-rpc" ? "gRPC" : ""].filter(Boolean);
      return `${nameOf(map, l.to)} ×${l.count}${notes.length ? ` (${notes.join("; ")})` : ""}`;
    });
    sentences.push(`Calls: ${words.join(", ")}.`);
  }
  const callers = [...new Set(map.system.links.filter((l) => l.to === s.id && (l.kind === "calls-route" || l.kind === "calls-rpc")).map((l) => nameOf(map, l.from)))];
  if (callers.length) sentences.push(`Called by: ${callers.join(", ")}.`);
  const ids = new Set(mine.map((n) => n.id));
  const targets = (kind: "publishes" | "consumes" | "uses-service") =>
    map.edges
      .filter((e) => e.kind === kind && ids.has(e.from))
      .map((e) => map.nodes.find((n) => n.id === e.to))
      .filter((n): n is MapNode => !!n);
  const chan = (kind: "publishes" | "consumes") => [...new Set(targets(kind).map((n) => `${n.tech ?? "channel"} ${n.name}`))];
  const pub = chan("publishes");
  if (pub.length) sentences.push(`Publishes ${cap(pub, 8).join(", ")}.`);
  const con = chan("consumes");
  if (con.length) sentences.push(`Consumes ${cap(con, 8).join(", ")}.`);
  const outside = [...new Set(targets("uses-service").filter((n) => !n.internal).map((n) => n.name))];
  if (outside.length) sentences.push(`Talks outside to ${outside.join(", ")}.`);
  const what = `${s.framework ? `${s.framework} ` : ""}app${s.areas.length ? ` in ${s.areas.map((a) => `${a}/`).join(", ")}` : ""}${s.repo ? ` (repo ${s.repo})` : ""}`;
  return `- ${s.name} [${s.id}] — ${what}${facts.length ? ` (${facts.join("; ")})` : ""}. ${sentences.join(" ")}`;
}

/** Level 2 of one service: the per-layer lists, capped per service. */
function insideLines(map: CodeMap, s: ServiceDef): string[] {
  const mine = nodesIn(map, s.id);
  const ui = mine.filter((n) => n.layer === "ui").map((n) => n.name);
  const routes = mine.filter((n) => n.kind === "route" || n.kind === "rpc").map((n) => `${n.kind === "rpc" ? "gRPC " : ""}${n.name} (${n.file})`);
  const logic = mine.filter((n) => n.layer === "logic").map((n) => n.name);
  const tables = s.kind === "app" ? mine.filter((n) => n.kind === "table") : tablesInDb(map, s.id);
  const lines = [`### ${s.name} [${s.id}]`];
  if (ui.length) lines.push(`Pages & components (ui): ${cap(ui, PER_SERVICE.ui).join(", ")}`);
  if (routes.length) lines.push(`Routes (api): ${cap(routes, PER_SERVICE.routes).join("; ")}`);
  if (logic.length) lines.push(`Logic modules: ${cap(logic, PER_SERVICE.logic).join(", ")}`);
  const shared = (t: MapNode) => ((t.usedBy?.length ?? 0) > 1 ? ` (shared by ${t.usedBy!.map((u) => nameOf(map, u)).join(", ")})` : "");
  if (tables.length) lines.push(`Tables: ${cap(tables.map((t) => `${t.name}${shared(t)}`), PER_SERVICE.tables).join(", ")}`);
  if (lines.length === 1) lines.push("(nothing parsed inside)");
  return lines;
}
