// The Learn professor's view of the computer WalkMyCode runs on (the student asked for "full access to the PC it
// lives on"): find files by name anywhere the user's account can open them, and read a document's text. Read only:
// nothing here writes, moves, deletes or runs anything. Secrets are never found or read: .env and key files, SSH,
// cloud and package-manager credentials, password stores, and the app-data folders where browsers keep passwords
// and cookies. Only on a server that runs on this computer (the desktop app, `npm run dev`), never a hosted one.
import "server-only";
import { existsSync, readFileSync, statSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, extname, isAbsolute, join, normalize, sep } from "node:path";
import { docxToMarkdown, slideToMarkdown } from "@/learn/lib/docText";
import { DOC_MAX, unzip } from "./learnDocs";

/** What a search for documents finds: papers, reports, notes and slides. */
export const DOC_KINDS = new Set([".pdf", ".docx", ".pptx", ".md", ".markdown", ".txt", ".rtf", ".tex", ".bib", ".epub"]);
/** Found first among documents: what a paper or a report is usually saved as. */
const PAPER_KINDS = new Set([".pdf", ".docx"]);
/** Read as they are, besides documents: data and code. */
const TEXT_KINDS = new Set([".csv", ".json", ".html", ".htm", ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".cs", ".rb", ".php", ".sql", ".r", ".m", ".ipynb", ".yaml", ".yml", ".toml", ".xml"]);

/** The most text one read hands the model (about 15,000 words); the rest is a later read from a later page. */
export const READ_CHARS = 60_000;
/** A search stops after this long, or this many folders, and says it stopped. */
export const FIND_MS = 8000;
const FIND_DIRS = 150_000;
const FIND_MAX = 25;

/** Folder names never walked: programs, caches, build output, version control, and where secrets live. */
const SKIP_DIRS = new Set(
  [
    "node_modules", ".git", ".hg", ".svn", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache", ".next", ".nuxt", "dist", "build", "target", "out", ".cache", ".npm", ".pnpm-store", ".yarn", ".cargo", ".rustup", ".gradle", ".m2", ".nuget", ".vscode-server",
    "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)", "programdata", "recovery", "perflogs", "msocache", "$windows.~bt", "$windows.~ws", "config.msi",
    "proc", "sys", "dev", "run", "boot", "snap", "lost+found",
  ].map((d) => d.toLowerCase()),
);

/** Folders whose files are secrets, or where browsers and apps keep passwords, cookies and tokens. */
const SECRET_DIRS = new Set([".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".password-store", ".walkmycode", ".lantern", "appdata", "keychains", ".config/gh", ".mozilla", "credentials"].map((d) => d.toLowerCase()));
const SECRET_FILE = /^(\.env(\..*)?|keys\.env|\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|credentials(\.json)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|known_hosts|authorized_keys|.*\.(pem|key|p12|pfx|kdbx|keychain|ovpn|jks|keystore))$/i;

/** Whether a path is a secret, or inside a folder of them: never listed, never read. */
export function isSecret(path: string): boolean {
  const parts = normalize(path).split(/[\\/]+/).map((p) => p.toLowerCase());
  if (SECRET_FILE.test(parts.at(-1) ?? "")) return true;
  return parts.some(
    (p, i) =>
      // App data holds browsers' passwords and cookies; its Temp folder holds ordinary files (opened attachments).
      (SECRET_DIRS.has(p) && !(p === "appdata" && parts[i + 1] === "local" && parts[i + 2] === "temp")) || (p === ".config" && parts[i + 1] === "gh") || (p === "library" && parts[i + 1] === "keychains"),
  );
}

/** Where to look, nearest first: the user's own folders, then the rest of the home folder, then every other drive. */
export function searchRoots(home = homedir(), os = platform()): string[] {
  const near = ["Desktop", "Documents", "Downloads", "OneDrive", "OneDrive - Personal", "Dropbox", "Google Drive", "iCloudDrive"].map((d) => join(home, d)).filter((d) => existsSync(d));
  const roots = [...near, home];
  if (os === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${letter}:\\`;
      if (existsSync(drive)) roots.push(drive);
    }
  } else {
    for (const d of ["/mnt", "/media", "/Volumes", "/srv", "/opt", "/"]) if (existsSync(d)) roots.push(d);
  }
  return [...new Set(roots)];
}

export interface FoundFile {
  path: string;
  /** Bytes. */
  size: number;
  /** When it last changed (ISO date). */
  modified: string;
}

export interface FindResult {
  files: FoundFile[];
  /** The search stopped early (time or size): there may be more. */
  partial: boolean;
  searched: number;
}

const words = (q: string) => q.toLowerCase().normalize("NFKD").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/**
 * Files whose name has every word of `query` in it (any order, any case), nearest folders first, documents before
 * other files, newest first among equals. `kind` "documents" keeps only what the professor can read as a document.
 * Folders are read a few at a time without blocking the server (Talk keeps talking while he looks).
 */
export async function findFiles(query: string, o: { kind?: "documents" | "any"; roots?: string[]; deadlineMs?: number; now?: () => number; signal?: AbortSignal } = {}): Promise<FindResult> {
  const want = words(query);
  const now = o.now ?? Date.now;
  const stopAt = now() + (o.deadlineMs ?? FIND_MS);
  const docsOnly = (o.kind ?? "documents") === "documents";
  const found: (FoundFile & { score: number })[] = [];
  const seen = new Set<string>();
  const queue = [...(o.roots ?? searchRoots())];
  let searched = 0;
  let partial = false;
  if (!want.length) return { files: [], partial: false, searched: 0 };
  const over = () => o.signal?.aborted || now() > stopAt || searched >= FIND_DIRS;
  const visit = async (dir: string) => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // not ours to open
    }
    searched++;
    for (const e of entries) {
      const name = e.name;
      const full = join(dir, name);
      if (e.isDirectory()) {
        const low = name.toLowerCase();
        if (SKIP_DIRS.has(low) || SECRET_DIRS.has(low) || low.startsWith(".")) continue;
        queue.push(full);
        continue;
      }
      if (!e.isFile() || isSecret(full)) continue;
      const ext = extname(name).toLowerCase();
      const isDoc = DOC_KINDS.has(ext);
      if (docsOnly && !isDoc) continue;
      const low = name.toLowerCase().normalize("NFKD");
      if (!want.every((w) => low.includes(w)) || found.length >= 400) continue;
      try {
        const st = await stat(full);
        found.push({ path: full, size: st.size, modified: new Date(st.mtimeMs).toISOString().slice(0, 10), score: (PAPER_KINDS.has(ext) ? 4 : isDoc ? 2 : 0) + (low.startsWith(want[0]) ? 1 : 0) + st.mtimeMs / 1e13 });
      } catch {
        // gone, or not ours
      }
    }
  };
  // A few readers at once, nearest folders first (the queue is breadth-first).
  const worker = async () => {
    while (queue.length) {
      if (over()) {
        partial = true;
        return;
      }
      const dir = queue.shift()!;
      const key = dir.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      await visit(dir);
    }
  };
  // Workers that find the queue empty while others still read wait a moment and look again.
  const pool = async () => {
    for (;;) {
      await worker();
      if (partial || !queue.length) {
        await new Promise((r) => setTimeout(r, 5));
        if (partial || !queue.length) return;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, pool));
  found.sort((a, b) => b.score - a.score);
  return { files: found.slice(0, FIND_MAX).map(({ path, size, modified }) => ({ path, size, modified })), partial, searched };
}

export type ReadResult =
  | { path: string; kind: string; pages?: number; from?: number; to?: number; text: string; more: boolean }
  | { path: string; unreadable: string };

/** A PDF's text, one string per page (unpdf, as Learn's course folders read them). */
async function pdfPages(bytes: Buffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((p) => p.trim());
}

/**
 * A document's text, for the professor to read and cite. A PDF comes page by page, each page marked "[page N]", from
 * `fromPage` on, up to READ_CHARS; `more` says there is more to read from the page after `to`.
 */
export async function readDocument(rawPath: string, fromPage = 1, home = homedir()): Promise<ReadResult> {
  // The chat shows the home folder as ~ (shortPath), so a path read back from it works too.
  const path = /^~([\\/]|$)/.test(rawPath) ? join(home, rawPath.slice(1)) : rawPath;
  if (!isAbsolute(path)) return { path, unreadable: "Give the full path, as find_files gave it." };
  const full = normalize(path);
  const name = basename(full);
  if (isSecret(full)) return { path: full, unreadable: `${name} is a secret (a key, a password or credentials file): WalkMyCode never reads those.` };
  let size: number;
  try {
    const st = statSync(full);
    if (!st.isFile()) return { path: full, unreadable: `${name} is a folder, not a file.` };
    size = st.size;
  } catch {
    return { path: full, unreadable: `${name} is not there, or this account cannot open it.` };
  }
  const ext = extname(name).toLowerCase();
  if (ext === ".epub") return { path: full, unreadable: `${name} is an e-book; the professor reads PDF, Word, slides and text.` };
  if (!DOC_KINDS.has(ext) && !TEXT_KINDS.has(ext)) return { path: full, unreadable: `${name} is not a kind of file the professor reads (documents and text only).` };
  if (size > DOC_MAX * 4) return { path: full, unreadable: `${name} is larger than ${(DOC_MAX * 4) / 1024 / 1024} MB.` };
  try {
    const bytes = readFileSync(full);
    if (ext === ".pdf") {
      const pages = await pdfPages(bytes);
      if (!pages.some(Boolean)) return { path: full, unreadable: `${name} has no text in it (a scanned PDF is pictures of pages).` };
      const start = Math.min(Math.max(1, Math.floor(fromPage)), pages.length);
      let text = "";
      let to = start - 1;
      for (let i = start - 1; i < pages.length; i++) {
        const piece = `[page ${i + 1}]\n${pages[i]}\n\n`;
        if (text && text.length + piece.length > READ_CHARS) break;
        text += piece.length > READ_CHARS ? piece.slice(0, READ_CHARS) : piece;
        to = i + 1;
      }
      return { path: full, kind: "pdf", pages: pages.length, from: start, to, text: text.trim(), more: to < pages.length };
    }
    let text: string;
    if (ext === ".docx") {
      const xml = unzip(bytes, (n) => n === "word/document.xml").get("word/document.xml");
      text = xml ? docxToMarkdown(xml.toString("utf8")) : "";
    } else if (ext === ".pptx") {
      text = [...unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).entries()]
        .map(([n, xml]) => ({ n: Number(/slide(\d+)\.xml$/.exec(n)![1]), xml: xml.toString("utf8") }))
        .sort((a, b) => a.n - b.n)
        .map((x) => slideToMarkdown(x.xml, x.n))
        .join("\n\n");
    } else {
      text = bytes.toString("utf8");
      if (text.includes("\u0000")) return { path: full, unreadable: `${name} is not text.` };
    }
    if (!text.trim()) return { path: full, unreadable: `${name} has no text in it.` };
    // Long text documents read in parts too: "page" N is the Nth part of READ_CHARS characters.
    const parts = Math.max(1, Math.ceil(text.length / READ_CHARS));
    const part = Math.min(Math.max(1, Math.floor(fromPage)), parts);
    return { path: full, kind: ext.slice(1), ...(parts > 1 ? { pages: parts, from: part, to: part } : {}), text: text.slice((part - 1) * READ_CHARS, part * READ_CHARS), more: part < parts };
  } catch {
    return { path: full, unreadable: `${name} could not be read.` };
  }
}

/** The path as the student would say it: their home folder as ~ (shown in the chat, never sent anywhere). */
export function shortPath(path: string, home = homedir()): string {
  return path.toLowerCase().startsWith(home.toLowerCase() + sep.toLowerCase()) ? `~${path.slice(home.length)}` : path;
}

// ── The professor's tools ──

/** What the professor is told he can do with the computer, added to his instructions when he may look. */
export const PC_SYSTEM = [
  "You can look at the student's computer, read only, with two tools:",
  "- find_files searches file names across the whole computer (the student's own folders first). Search with two or three distinctive words from the title or the file name; if nothing comes back, try other words, fewer words, or kind \"any\".",
  "- read_document reads a document's text: PDF (page by page, each page marked [page N]), Word, PowerPoint, Markdown, text, LaTeX, CSV and code. While `more` is true there is more: read again from the page after `to`.",
  "Use them whenever the student asks about a file, a paper or a document on their computer, or asks you to find, read, summarise or review one. If several files could be the one meant, pick the likeliest, say which you chose and why, and offer the others.",
  "Read a document all the way through before you summarise or review it. Cite what you say with the page: (p. 4). Never claim to have read what you have not; if a file cannot be read, say why.",
  "A literature review: the paper's question and claim, its method and data, its findings, how it sits among the work it cites (name those works as the paper does), its strengths and limitations, and open questions, in that order, with page citations.",
  "You cannot change, move or delete files, run programs, or read secrets (keys, passwords, credentials): never offer to.",
].join("\n");

/** Why the professor may not look here (a hosted server), or null on the student's own computer. */
export function pcRefusal(env: Record<string, string | undefined> = process.env): string | null {
  return (env.WALKMYCODE_MODE ?? env.LANTERN_MODE)?.trim().toLowerCase() === "hosted" ? "This WalkMyCode runs on a server, not on your computer, so the professor cannot look at your files from here." : null;
}

/** The two tools as the SDK runs them (src/lib/providers/sdk.ts serverSdkTools), each answer kept small. */
export function pcTools(): { name: string; description: string; input_schema: Record<string, unknown>; run: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }[] {
  return [
    {
      name: "find_files",
      description: "Find files on the student's computer by words in their name. Searches every drive the student's account can open, their own folders first. Read only; never finds secrets.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Two or three words that are in the file's name, e.g. \"attention transformer\" or \"stuttering plan\"." },
          kind: { type: "string", enum: ["documents", "any"], description: "\"documents\" (PDF, Word, PowerPoint, Markdown, text, LaTeX; the default) or \"any\" file." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      run: async (input, signal) => {
        const r = await findFiles(String(input.query ?? ""), { kind: input.kind === "any" ? "any" : "documents", signal });
        return { files: r.files.map((f) => ({ path: f.path, size_kb: Math.max(1, Math.round(f.size / 1024)), modified: f.modified })), ...(r.partial ? { note: "The search stopped early; there may be more. Try more distinctive words." } : {}), ...(!r.files.length ? { note: "Nothing has those words in its name. Try other or fewer words, or kind \"any\"." } : {}) };
      },
    },
    {
      name: "read_document",
      description: "Read a document's text from the student's computer, by its full path (as find_files gave it). PDFs come page by page from from_page; read again from the next page while `more` is true. Read only; never reads secrets.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file's full path." },
          from_page: { type: "integer", minimum: 1, description: "The page to start from (default 1)." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      run: async (input) => readDocument(String(input.path ?? ""), typeof input.from_page === "number" ? input.from_page : 1),
    },
  ];
}

/** What the chat shows of one look: what was searched for or opened, and what came of it. Paths use ~ for home. */
export function lookNote(name: string, input: Record<string, unknown>, output: unknown): { tool: "find" | "read"; what: string; note: string } {
  if (name === "find_files") {
    const r = output as { files?: unknown[]; note?: string } | undefined;
    const n = r?.files?.length ?? 0;
    return { tool: "find", what: String(input.query ?? ""), note: n ? `${n} file${n === 1 ? "" : "s"} found` : "nothing found" };
  }
  const r = output as ReadResult | undefined;
  const what = shortPath(String(input.path ?? ""));
  if (!r) return { tool: "read", what, note: "" };
  if ("unreadable" in r) return { tool: "read", what, note: r.unreadable };
  return { tool: "read", what, note: !r.pages ? "read" : r.from === r.to ? `page ${r.from} of ${r.pages}` : `pages ${r.from}–${r.to} of ${r.pages}` };
}
