// Shared matchers: SQL in strings, outside services, HTTP methods.
import type { ColumnsFact, Method, ServiceFact, SqlFact } from "../facts";

export const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function asMethod(s: string | undefined): Method | undefined {
  if (!s) return undefined;
  const u = s.toUpperCase();
  if (u === "DEL") return "DELETE";
  return (METHODS as string[]).includes(u) ? (u as Method) : undefined;
}

// ── SQL ──────────────────────────────────────────────────────────────────────
// Only uppercase keywords count: plain English rarely shouts FROM or UPDATE.
const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|WITH|PRAGMA)\b/;
const RE_DEFINE = /\bCREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_]\w*)["`]?/g;
const RE_READ = /\b(?:FROM|JOIN)\s+["`]?([A-Za-z_]\w*)["`]?/g;
const RE_INSERT = /\b(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+["`]?([A-Za-z_]\w*)["`]?/g;
const RE_UPDATE = /\bUPDATE\s+(?:OR\s+\w+\s+)?["`]?([A-Za-z_]\w*)["`]?\s+SET\b/g;
const RE_DELETE = /\bDELETE\s+FROM\s+["`]?([A-Za-z_]\w*)["`]?/g;
const NOT_TABLES = new Set(["select", "where", "values", "set", "sqlite_master", "sqlite_sequence", "dual", "information_schema", "pragma_table_info"]);

/** Tables touched by an SQL string. `lineOf` maps an offset in the string to a file line. */
export function sqlInString(s: string, lineOf: (offset: number) => number): SqlFact[] {
  if (!SQL_KEYWORDS.test(s)) return [];
  const out: SqlFact[] = [];
  const add = (re: RegExp, op: SqlFact["op"]) => {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const table = m[1];
      if (NOT_TABLES.has(table.toLowerCase()) || /^[A-Z_]+$/.test(table) && table.length < 3) continue;
      out.push({ table, op, line: lineOf(m.index) });
    }
  };
  add(RE_DEFINE, "define");
  add(RE_INSERT, "write");
  add(RE_UPDATE, "write");
  add(RE_DELETE, "write");
  // DELETE FROM x would also hit RE_READ; only count reads in SELECT-ish text.
  if (/\bSELECT\b/.test(s)) add(RE_READ, "read");
  return out;
}

/** Lines in a CREATE TABLE's body that are no column: keys, indexes, checks. */
const NOT_COLUMN_SQL = /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|INDEX|KEY|FULLTEXT|SPATIAL|EXCLUDE|PERIOD|LIKE)\b/i;

/** The columns each CREATE TABLE in an SQL string lists: `CREATE TABLE todos (id SERIAL PRIMARY KEY, title TEXT)`
 * → id SERIAL, title TEXT. The type is as written, its size kept ("VARCHAR(255)"). */
export function sqlColumns(s: string, lineOf: (offset: number) => number): ColumnsFact[] {
  if (!/\bCREATE\b/.test(s)) return [];
  const out: ColumnsFact[] = [];
  const re = /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_]\w*)["`]?\s*\(/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    // The body, to its closing parenthesis; split at the top-level commas.
    const parts: string[] = [];
    let depth = 1;
    let cur = "";
    let i = re.lastIndex;
    for (; i < s.length && depth > 0; i++) {
      const ch = s[i];
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
      if (ch === "," && depth === 1) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (depth > 0) continue;
    parts.push(cur);
    const columns: ColumnsFact["columns"] = [];
    for (const raw of parts) {
      const p = raw.replace(/--[^\n]*/g, "").trim();
      if (!p || NOT_COLUMN_SQL.test(p)) continue;
      const col = /^["`[]?([A-Za-z_]\w*)["`\]]?(\s[\s\S]*)?$/.exec(p);
      if (!col) continue;
      const type = col[2] ? typeOfSql(col[2]) : undefined;
      columns.push(type ? { name: col[1], type } : { name: col[1] });
    }
    if (columns.length) out.push({ table: m[1], columns, line: lineOf(m.index) });
  }
  return out;
}

/** A column's type at the start of its definition: "VARCHAR(255) NOT NULL" → "VARCHAR(255)", "DOUBLE PRECISION" → "DOUBLE PRECISION". */
function typeOfSql(def: string): string | undefined {
  const m = /^(DOUBLE\s+PRECISION|CHARACTER\s+VARYING(?:\s*\([^)]*\))?|TIMESTAMP(?:\s*\(\d+\))?\s+WITH(?:OUT)?\s+TIME\s+ZONE|[A-Za-z_]\w*(?:\s*\([^)]*\))?(?:\[\])?)/i.exec(def.trim());
  return m ? m[1].replace(/\s+/g, " ") : undefined;
}

// ── Outside services ─────────────────────────────────────────────────────────
export const HOST_SERVICES: [RegExp, string][] = [
  [/(^|\.)deepgram\.com$/, "Deepgram"],
  [/(^|\.)anthropic\.com$/, "Anthropic (Claude)"],
  [/(^|\.)openai\.com$/, "OpenAI"],
  [/(^|\.)groq\.com$/, "Groq"],
  [/generativelanguage\.googleapis\.com$/, "Google Gemini"],
  [/(^|\.)googleapis\.com$/, "Google APIs"],
  [/accounts\.google\.com$/, "Google sign-in"],
  [/(^|\.)stripe\.com$/, "Stripe"],
  [/(^|\.)paystack\.co$/, "Paystack"],
  [/(^|\.)supabase\.(co|com|in)$/, "Supabase"],
  [/(^|\.)resend\.com$/, "Resend (email)"],
  [/(^|\.)sendgrid\.(com|net)$/, "SendGrid (email)"],
  [/(^|\.)twilio\.com$/, "Twilio"],
  [/(^|\.)arkesel\.com$/, "Arkesel (SMS)"],
  [/(^|\.)microsoftonline\.com$/, "Microsoft sign-in"],
  [/graph\.microsoft\.com$/, "Microsoft Graph"],
  [/api\.github\.com$/, "GitHub API"],
  [/(^|\.)cloudflare\.com$/, "Cloudflare"],
  [/(^|\.)elevenlabs\.io$/, "ElevenLabs"],
  [/(^|\.)mistral\.ai$/, "Mistral"],
  [/(^|\.)cohere\.(ai|com)$/, "Cohere"],
  [/(^|\.)huggingface\.co$/, "Hugging Face"],
  [/(^|\.)replicate\.com$/, "Replicate"],
  [/(^|\.)clerk\.(com|dev)$/, "Clerk (auth)"],
  [/(^|\.)auth0\.com$/, "Auth0"],
  [/(^|\.)firebaseio\.com$|(^|\.)firebase\.google\.com$/, "Firebase"],
  [/(^|\.)algolia\.net$/, "Algolia"],
  [/(^|\.)mailgun\.net$/, "Mailgun"],
  [/(^|\.)postmarkapp\.com$/, "Postmark"],
  [/(^|\.)slack\.com$/, "Slack"],
  [/(^|\.)notion\.com$/, "Notion"],
  [/(^|\.)vercel\.com$/, "Vercel"],
  [/(^|\.)amazonaws\.com$/, "AWS"],
  [/(^|\.)r2\.cloudflarestorage\.com$/, "Cloudflare R2"],
];

export const PACKAGE_SERVICES: Record<string, string> = {
  "@anthropic-ai/sdk": "Anthropic (Claude)",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  "@deepgram/sdk": "Deepgram",
  deepgram: "Deepgram",
  stripe: "Stripe",
  "@stripe/stripe-js": "Stripe",
  "@supabase/supabase-js": "Supabase",
  "@supabase/ssr": "Supabase",
  supabase: "Supabase",
  resend: "Resend (email)",
  "@sendgrid/mail": "SendGrid (email)",
  sendgrid: "SendGrid (email)",
  twilio: "Twilio",
  "@clerk/nextjs": "Clerk (auth)",
  "@clerk/clerk-react": "Clerk (auth)",
  "next-auth": "NextAuth",
  "@auth0/nextjs-auth0": "Auth0",
  "firebase-admin": "Firebase",
  firebase: "Firebase",
  "@google/generative-ai": "Google Gemini",
  "google-generativeai": "Google Gemini",
  groq: "Groq",
  "groq-sdk": "Groq",
  "@octokit/rest": "GitHub API",
  octokit: "GitHub API",
  boto3: "AWS",
  "@aws-sdk/client-s3": "AWS S3",
  pusher: "Pusher",
  "@upstash/redis": "Upstash Redis",
  redis: "Redis",
  ioredis: "Redis",
  mongodb: "MongoDB",
  mongoose: "MongoDB",
  pymongo: "MongoDB",
  "@vercel/blob": "Vercel Blob",
  cloudinary: "Cloudinary",
  algoliasearch: "Algolia",
  "@sentry/nextjs": "Sentry",
  "sentry-sdk": "Sentry",
  posthog: "PostHog",
  "posthog-js": "PostHog",
  "posthog-node": "PostHog",
  smtplib: "Email (SMTP)",
  nodemailer: "Email (SMTP)",
  "@tauri-apps/api": "Tauri (desktop shell)",
  // Dart / Flutter packages (`package:<name>/...`)
  firebase_core: "Firebase",
  firebase_auth: "Firebase",
  cloud_firestore: "Firebase",
  firebase_storage: "Firebase",
  firebase_messaging: "Firebase",
  firebase_analytics: "Firebase",
  firebase_crashlytics: "Firebase",
  firebase_database: "Firebase",
  cloud_functions: "Firebase",
  supabase_flutter: "Supabase",
  google_sign_in: "Google sign-in",
  flutter_stripe: "Stripe",
  sentry_flutter: "Sentry",
  sentry_dio: "Sentry",
  onesignal_flutter: "OneSignal",
  google_maps_flutter: "Google Maps",
  google_generative_ai: "Google Gemini",
  dart_openai: "OpenAI",
  purchases_flutter: "RevenueCat",
  posthog_flutter: "PostHog",
  mixpanel_flutter: "Mixpanel",
  flutter_paystack: "Paystack",
  pusher_channels_flutter: "Pusher",
  appwrite: "Appwrite",
  pocketbase: "PocketBase",
  amplify_flutter: "AWS Amplify",
};

export const ENV_SERVICES: [RegExp, string][] = [
  [/^STRIPE_/, "Stripe"],
  [/^PAYSTACK_/, "Paystack"],
  [/^RESEND_/, "Resend (email)"],
  [/^SENDGRID_/, "SendGrid (email)"],
  [/^DEEPGRAM_/, "Deepgram"],
  [/^OPENAI_/, "OpenAI"],
  [/^ANTHROPIC_/, "Anthropic (Claude)"],
  [/^GROQ_/, "Groq"],
  [/^GEMINI_|^GOOGLE_API_KEY$|^GOOGLE_GENERATIVE/, "Google Gemini"],
  [/^SUPABASE_|^NEXT_PUBLIC_SUPABASE_/, "Supabase"],
  [/^TWILIO_/, "Twilio"],
  [/^SMTP_/, "Email (SMTP)"],
  [/^CLERK_|^NEXT_PUBLIC_CLERK_/, "Clerk (auth)"],
  [/^GITHUB_CLIENT|^GITHUB_TOKEN|^GITHUB_APP/, "GitHub API"],
  [/^AWS_/, "AWS"],
  [/^R2_/, "Cloudflare R2"],
  [/^SENTRY_/, "Sentry"],
  [/^POSTHOG_|^NEXT_PUBLIC_POSTHOG_/, "PostHog"],
  [/^ARKESEL_/, "Arkesel (SMS)"],
  [/^ELEVENLABS_/, "ElevenLabs"],
];

export function serviceForHost(host: string): string | null {
  const h = host.toLowerCase();
  for (const [re, name] of HOST_SERVICES) if (re.test(h)) return name;
  return null;
}

export function serviceForPackage(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const py = pkg.split(".")[0];
  return PACKAGE_SERVICES[pkg] ?? PACKAGE_SERVICES[py] ?? null;
}

export function serviceForEnv(name: string): string | null {
  for (const [re, svc] of ENV_SERVICES) if (re.test(name)) return svc;
  return null;
}

/** Hosts mentioned in a string literal (URLs only). */
export function hostsIn(s: string): string[] {
  const out: string[] = [];
  const re = /\b(?:https?|wss?):\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/:"'`\s]|$)/gi;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[1]);
  return out;
}

export function serviceFacts(text: string, line: number, via: ServiceFact["via"]): ServiceFact[] {
  const out: ServiceFact[] = [];
  for (const h of hostsIn(text)) {
    const svc = serviceForHost(h);
    if (svc) out.push({ service: svc, line, via, text: h });
  }
  return out;
}
