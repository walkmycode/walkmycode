// An app's own settings files: Spring's application.properties and application.yml, and
// ASP.NET Core's appsettings.json. Each key becomes a setting the map knows, named the way the
// code reads it: `users.url` for `@Value("${users.url}")`, `Users:Url` for
// `configuration["Users:Url"]`. A value that points at the environment (`${USERS_URL}`,
// `${USERS_URL:http://users:8080}`) says so in `ref`; index.ts then gives the setting the
// environment's value, or its own default. A profile's file (application-dev.yml,
// appsettings.Development.json) is one way the app can run, so its values are a guess beside the
// base file's. Values that could be secrets are hidden as they are read.
import { isMap, isScalar, LineCounter, parseAllDocuments } from "yaml";
import { redactValue, unquote } from "./files";
import type { ConfigFacts } from "./types";

export interface SettingLine {
  name: string;
  /** The value, or the default of `${ENV:default}`; undefined when it is `${ENV}` alone. */
  value?: string;
  /** The environment setting the value is read from. */
  ref?: string;
  line: number;
}

/** `${USERS_URL:http://users:8080}` → the env setting and its default. */
function placeholder(raw: string): { ref: string; fallback?: string } | null {
  const m = /^\$\{([A-Za-z_][\w.-]*)(?::(.*))?\}$/.exec(raw.trim());
  return m ? { ref: m[1], ...(m[2] !== undefined && m[2] !== "" ? { fallback: m[2] } : {}) } : null;
}

function setting(name: string, raw: string, line: number): SettingLine {
  const p = placeholder(raw);
  const value = p ? p.fallback : raw;
  return { name, line, ...(value !== undefined ? { value: redactValue(name, value) } : {}), ...(p ? { ref: p.ref } : {}) };
}

/** application.properties: `key=value` or `key: value` lines; `#` and `!` start a comment. */
export function readProperties(content: string): SettingLine[] {
  const out: SettingLine[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([A-Za-z_][\w.\-[\]]*)\s*[=:]\s*(.*?)\s*$/.exec(lines[i].replace(/\r$/, ""));
    if (!m || /^\s*[#!]/.test(lines[i])) continue;
    out.push(setting(m[1], unquote(m[2]), i + 1));
  }
  return out;
}

/** A tree of settings (YAML, or JSON, which YAML reads) as flat names: `users: { url: x }` is
 * `users.url` with "." between, `Users:Url` with ":". Lists are left out. */
export function readTree(content: string, sep: "." | ":"): SettingLine[] {
  const out: SettingLine[] = [];
  const counter = new LineCounter();
  // appsettings.json may hold // comments, which neither JSON nor YAML has: blanked, line for line.
  const text = sep === ":" ? content.replace(/^(\s*)\/\/.*$/gm, "$1") : content;
  const walk = (node: unknown, prefix: string) => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      if (!isScalar(pair.key)) continue;
      const name = prefix ? `${prefix}${sep}${String(pair.key.value)}` : String(pair.key.value);
      const v = pair.value;
      if (isMap(v)) walk(v, name);
      else if (isScalar(v) && v.value !== null && v.value !== undefined) out.push(setting(name, String(v.value), counter.linePos(pair.key.range?.[0] ?? 0).line));
    }
  };
  try {
    for (const doc of parseAllDocuments(text, { lineCounter: counter })) walk(doc.contents, "");
  } catch {
    // Not YAML or JSON after all: no settings from it.
  }
  return out;
}

/** The profile a settings file is for ("dev" for application-dev.yml, "Development" for appsettings.Development.json), or null for the base file. */
export function profileOf(path: string): string | null {
  const b = path.slice(path.lastIndexOf("/") + 1);
  return /^application-([\w.-]+)\.(?:properties|ya?ml)$/i.exec(b)?.[1] ?? /^appsettings\.([\w-]+)\.json$/i.exec(b)?.[1] ?? null;
}

/** One settings file's keys, as the config facts hold them, with the env settings they point at. */
export function readSettings(path: string, content: string): { values: ConfigFacts["envValues"]; refs: { name: string; ref: string; file: string; line: number }[] } {
  const lines = /\.properties$/i.test(path) ? readProperties(content) : readTree(content, /\.json$/i.test(path) ? ":" : ".");
  const profile = profileOf(path);
  const likely = profile ? { likely: `in the ${profile} profile's settings` } : {};
  return {
    values: lines.filter((l) => l.value !== undefined).map((l) => ({ name: l.name, value: l.value!, file: path, line: l.line, ...likely })),
    refs: lines.filter((l) => l.ref).map((l) => ({ name: l.name, ref: l.ref!, file: path, line: l.line })),
  };
}
