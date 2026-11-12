// .env.example / .sample / .template / .dist: NAME=value lines. Real .env
// files never get this far (the folder readers do not keep them, and build.ts
// marks them secret). Values are redacted as they are read.
import { redactValue, unquote } from "./files";

export interface EnvLine {
  name: string;
  value: string;
  line: number;
}

const LINE = /^\s*(export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

export function readEnvFile(content: string): EnvLine[] {
  const out: EnvLine[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i].replace(/\r$/, ""));
    if (!m) continue;
    let raw = m[3].trim();
    // An unquoted value ends at " #": the rest is a comment.
    if (!/^["']/.test(raw)) {
      const c = raw.search(/\s#/);
      if (c >= 0) raw = raw.slice(0, c).trim();
    }
    out.push({ name: m[2], value: redactValue(m[2], unquote(raw)), line: i + 1 });
  }
  return out;
}
