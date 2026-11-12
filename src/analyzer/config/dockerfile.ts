// Dockerfile, Dockerfile.*, *.dockerfile: EXPOSE, ENV and the last CMD /
// ENTRYPOINT, read line by line. The folder it sits in is an app service
// unless compose already names one built from here.
import { redactValue, unquote } from "./files";
import type { ConfigService } from "./types";

export interface DockerfileFacts {
  expose: { port: number; line: number }[];
  env: { name: string; value: string; line: number }[];
  /** The start command as it would be typed, e.g. "node src/index.js". */
  entry?: { text: string; line: number };
  framework?: string;
  /** First FROM line, so a Dockerfile always has an evidence line. */
  fromLine?: number;
  /** LABEL values that name the service (`name`, `service`, `org.opencontainers.image.title`). */
  labels: { value: string; line: number }[];
}

const HINTS: [RegExp, string][] = [
  [/\buvicorn\b/, "uvicorn"],
  [/\bgunicorn\b/, "gunicorn"],
  [/\bflask\b/, "Flask"],
  [/\bnext\b/, "Next.js"],
  [/\bnpm\s+(run\s+)?start\b/, "Node.js"],
  [/\bnode\b/, "Node.js"],
];

export function readDockerfile(content: string): DockerfileFacts {
  const out: DockerfileFacts = { expose: [], env: [], labels: [] };
  const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
  let lastCmd: { text: string; line: number } | undefined;
  let lastEntrypoint: { text: string; line: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    // Join continuation lines ("\" at the end) into one instruction.
    let text = lines[i];
    while (/\\\s*$/.test(text) && i + 1 < lines.length) text = text.replace(/\\\s*$/, " ") + lines[++i].trim();
    const m = /^\s*([A-Za-z]+)\s+(.*)$/.exec(text);
    if (!m) continue;
    const op = m[1].toUpperCase();
    const arg = m[2].trim();
    const line = start + 1;
    if (op === "FROM" && out.fromLine === undefined) out.fromLine = line;
    else if (op === "EXPOSE") {
      for (const p of arg.split(/\s+/)) {
        const n = parseInt(p, 10);
        if (n > 0 && n < 65536) out.expose.push({ port: n, line });
      }
    } else if (op === "ENV") {
      if (/^\w+=/.test(arg)) {
        for (const pm of arg.matchAll(/(\w+)=("[^"]*"|'[^']*'|\S+)/g)) out.env.push({ name: pm[1], value: redactValue(pm[1], unquote(pm[2])), line });
      } else {
        const kv = /^(\w+)\s+(.+)$/.exec(arg);
        if (kv) out.env.push({ name: kv[1], value: redactValue(kv[1], unquote(kv[2])), line });
      }
    } else if (op === "LABEL") {
      for (const pm of arg.matchAll(/([\w.-]+)=("[^"]*"|'[^']*'|\S+)/g)) if (/(^|\.)(name|title|service)$/i.test(pm[1])) out.labels.push({ value: unquote(pm[2]), line });
    } else if (op === "CMD") lastCmd = { text: commandText(arg), line };
    else if (op === "ENTRYPOINT") lastEntrypoint = { text: commandText(arg), line };
  }
  // ENTRYPOINT + CMD: the command is both, and the ENTRYPOINT line is where it starts.
  const cmd = lastEntrypoint ? { text: [lastEntrypoint.text, lastCmd?.text].filter(Boolean).join(" "), line: lastEntrypoint.line } : lastCmd;
  if (cmd) {
    out.entry = { text: cmd.text, line: cmd.line };
    out.framework = HINTS.find(([re]) => re.test(cmd.text))?.[1];
  }
  return out;
}

/** `["node", "src/index.js"]` → `node src/index.js`; shell form as written. */
function commandText(arg: string): string {
  if (arg.startsWith("[")) {
    try {
      const a = JSON.parse(arg) as unknown;
      if (Array.isArray(a)) return a.map(String).join(" ");
    } catch {
      /* shell form after all */
    }
  }
  return arg;
}

/** The service a Dockerfile describes: its folder, named after the folder. */
export function dockerfileService(path: string, dir: string, name: string, d: DockerfileFacts): ConfigService {
  const env: ConfigService["env"] = {};
  for (const e of d.env) env[e.name] = { value: e.value, line: e.line };
  const ports: ConfigService["ports"] = [];
  for (const e of d.expose) if (!ports.some((p) => p.container === e.port)) ports.push({ container: e.port });
  return {
    name,
    kind: "app",
    dir,
    hostnames: [],
    ports,
    env,
    envFiles: [],
    dependsOn: [],
    entry: d.entry?.text,
    entryLine: d.entry?.line,
    entryFile: d.entry ? path : undefined,
    framework: d.framework,
    ...(d.labels.length ? { labels: d.labels } : {}),
    file: path,
    line: d.entry?.line ?? d.fromLine ?? 1,
    source: "dockerfile",
  };
}
