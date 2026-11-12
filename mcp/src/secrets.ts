// The secret guard for everything WalkMyCode hands to Claude (docs/MCP.md §6).
// The folder reader never reads .env files or key files, the analyzer skips
// secret files, and config files are kept with their secret values hidden
// (src/analyzer/config/files.ts). This is the last line: every tool result
// passes through guardText on its way out, so a key pasted into code, a token
// inside a question typed on the page, or a key the user saved in
// ~/.walkmycode/keys.env never reaches Claude. Lines are never added or removed,
// so file:line citations still point at the right place.
import { REDACTED } from "../../src/analyzer/config/files";
import { keyEnvAllowlist } from "../../src/lib/providers/catalogue";
import { readKeys } from "../../src/lib/providers/keys";

/** Environment settings that hold a secret by their name (the same words the analyzer's guard uses). */
const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)$/i;
/** The shell's own folders, which only look like secrets by their names. */
const NOT_SECRET = new Set(["PWD", "OLDPWD"]);

/** The values of the keys this machine holds: ~/.walkmycode/keys.env, and key-like settings WalkMyCode was started with. */
export function knownSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  try {
    for (const v of readKeys().values()) if (v.length >= 8) out.add(v);
  } catch {
    // no keys file, or unreadable: nothing to add
  }
  const names = new Set(keyEnvAllowlist());
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && !NOT_SECRET.has(name.toUpperCase()) && (names.has(name) || SECRET_ENV_NAME.test(name))) out.add(value);
  }
  // Longest first, so a key that contains another is hidden whole.
  return [...out].sort((a, b) => b.length - a.length);
}

/** A private key block: its BEGIN and END lines stay, everything between is hidden line by line. */
const PEM = /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g;

/** Keys that announce themselves by a prefix. The part after it must hold a digit, so `sk-ant-…` goes and `pk-container` stays. */
const PREFIXED: RegExp[] = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\b(?:sk|pk|rk)[-_](?:(?:live|test|proj|ant|svcacct|admin|api\d*)[-_])*(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/g,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\b(?:gsk|xai|whsec|sk)_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** `Authorization: Bearer abc…`, `token abc…`: the credential after the scheme word (a `${…}` reference stays). */
const AUTH = /\b(Bearer|Basic|token)(\s+)(?![$•{<])([A-Za-z0-9._~+/=-]{12,})/g;
/** `postgres://user:password@host` → `postgres://user:•••@host`. */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:)([^\s@/'"`]+)@/gi;
/** `apiKey = "…"`, `"client_secret": "…"`, `PASSWORD='…'`: a quoted value given to a name that says it is secret. */
const SECRET_ASSIGN = /\b([\w-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|client[_-]?key)[\w-]*["']?\s*(?:=|:)\s*)(["'`])([^"'`\s]{8,})\2/gi;
/** Long hex (Deepgram keys, signing secrets); long runs of key characters; base64 with + or /. */
const HEX = /\b(?=[A-Fa-f0-9]*\d)[A-Fa-f0-9]{32,}\b/g;
const RUN = /(?<![A-Za-z0-9_/+-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_/+-])/g;
const BASE64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/g;

/** Bits per character: random keys are near 6 for base64, words and paths far lower. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A value is hidden when it looks like a key: long enough, and letters mixed with digits. */
function keyLike(v: string): boolean {
  return v.length >= 20 || (v.length >= 12 && /\d/.test(v) && /[A-Za-z]/.test(v));
}

/**
 * Text as Claude may see it: every known key value, private key block and
 * key-like string replaced by "•••". `secrets` are the values to hide whatever
 * they look like (by default the machine's own keys).
 */
export function guardText(text: string, secrets: string[] = knownSecrets()): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join(REDACTED);
  out = out.replace(PEM, (_, begin: string, body: string, end: string) => `${begin}${body.replace(/[A-Za-z0-9+/=]{16,}/g, REDACTED)}${end}`);
  for (const re of PREFIXED) out = out.replace(re, REDACTED);
  out = out.replace(AUTH, `$1$2${REDACTED}`);
  out = out.replace(URL_PASSWORD, `$1${REDACTED}@`);
  out = out.replace(SECRET_ASSIGN, (whole, head: string, q: string, value: string) => (keyLike(value) && !value.includes(REDACTED) ? `${head}${q}${REDACTED}${q}` : whole));
  out = out.replace(HEX, REDACTED);
  out = out.replace(RUN, (run) => (entropy(run) >= 4 ? REDACTED : run));
  out = out.replace(BASE64, (run) => (/[+/]/.test(run) && /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run) && entropy(run) >= 4.5 ? REDACTED : run));
  return out;
}
