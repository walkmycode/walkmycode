/**
 * The Markdown preview's drawing (MarkdownPreview.tsx): a Markdown file read with @lezer/markdown (GitHub's
 * flavour) and drawn as React elements. Kept apart from the component and its stylesheet, so it can be
 * tested on its own (tests/markdownPreview.test.tsx).
 */
import { GFM, parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { useMemo, useState, type ReactNode } from "react";
import { highlight } from "@/learn/lib/highlight";

const parser = baseParser.configure(GFM);

type Ref = { url: string; title?: string };
type Ctx = {
  src: string;
  refs: Map<string, Ref>;
  /** The folder the file is in, for its relative links ("" at the root). */
  dir: string;
  onOpen?: (path: string) => void;
  /** Heading ids already given out, for -1, -2 on repeats (as GitHub does). */
  ids: Map<string, number>;
  key: number;
};

const kids = (n: SyntaxNode): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};
const text = (c: Ctx, from: number, to: number) => c.src.slice(from, to);
const MARKS = new Set(["HeaderMark", "QuoteMark", "ListMark", "EmphasisMark", "CodeMark", "LinkMark", "StrikethroughMark", "TaskMarker", "TableDelimiter"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", larr: "←", rarr: "→", times: "×" };
function entity(e: string): string {
  const m = /^&(#x[\da-f]+|#\d+|\w+);$/i.exec(e);
  if (!m) return e;
  const v = m[1];
  if (v[0] === "#") {
    const code = v[1] === "x" || v[1] === "X" ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : e;
  }
  return ENTITIES[v.toLowerCase()] ?? e;
}

/** A label as a reference key: case and runs of space don't matter. */
const refKey = (label: string) => label.replace(/^\[|\]$/g, "").trim().replace(/\s+/g, " ").toLowerCase();

/** GitHub's id for a heading: lower case, punctuation dropped, spaces to dashes. */
function slug(c: Ctx, words: string): string {
  const base = words.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-") || "section";
  const n = c.ids.get(base) ?? 0;
  c.ids.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

/** The words of a node, without its marks: for a heading's id and an image's description. */
function plain(c: Ctx, n: SyntaxNode): string {
  let out = "";
  let at = n.from;
  for (const k of kids(n)) {
    out += text(c, at, k.from);
    if (!MARKS.has(k.name) && k.name !== "URL" && k.name !== "LinkTitle" && k.name !== "LinkLabel") out += k.name === "Escape" ? text(c, k.from + 1, k.to) : plain(c, k);
    at = k.to;
  }
  return out + text(c, at, n.to);
}

/** Where a link goes: out of the app (http, https, mailto), a heading on this page, or a file in the project. */
export type Target = { kind: "out"; href: string } | { kind: "here"; id: string } | { kind: "file"; path: string; id?: string } | { kind: "none" };
function target(c: Ctx, url: string): Target {
  return linkTarget(url, c.dir);
}

/** Where a link goes, from the folder of the file it is in. */
export function linkTarget(url: string, dir: string): Target {
  const u = url.trim().replace(/^<|>$/g, "");
  if (/^(https?:|mailto:)/i.test(u)) return { kind: "out", href: u };
  if (u.startsWith("#")) return { kind: "here", id: decodeURIComponent(u.slice(1)).toLowerCase() };
  // Any other scheme (javascript:, data:, file:) goes nowhere.
  if (/^[a-z][\w+.-]*:/i.test(u) || u.startsWith("//")) return { kind: "none" };
  const [rel, hash] = u.split("#");
  const parts = (u.startsWith("/") ? [] : dir ? dir.split("/") : []) as string[];
  for (const p of decodeURIComponent(rel.split("?")[0]).split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.length ? { kind: "file", path: parts.join("/"), ...(hash ? { id: hash.toLowerCase() } : {}) } : { kind: "none" };
}

function scrollToId(from: HTMLElement, id: string) {
  const root = from.closest(".mdp");
  const el = root?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function Anchor({ c, url, title, children }: { c: Ctx; url: string; title?: string; children: ReactNode }) {
  const t = target(c, url);
  if (t.kind === "out") {
    return <a href={t.href} target="_blank" rel="noopener noreferrer" title={title ?? t.href}>{children}</a>;
  }
  if (t.kind === "here") {
    return <a href={`#${t.id}`} title={title} onClick={(e) => { e.preventDefault(); scrollToId(e.currentTarget, t.id); }}>{children}</a>;
  }
  if (t.kind === "file") {
    const open = c.onOpen;
    return (
      <a href="#" className="mdp-file" title={title ?? `Open ${t.path}`} onClick={(e) => { e.preventDefault(); open?.(t.path); }}>
        {children}
      </a>
    );
  }
  return <span className="mdp-deadlink" title={title}>{children}</span>;
}

/** An image: from the web (https), else its description in a chip (a picture in the project isn't loaded here). */
function Img({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const s = src.trim().replace(/^<|>$/g, "");
  if (/^https:\/\//i.test(s) || /^data:image\/(png|gif|jpe?g|webp);/i.test(s)) {
    // eslint-disable-next-line @next/next/no-img-element -- a README's own picture, any size, from anywhere
    return <img src={s} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer" />;
  }
  return <span className="mdp-imgchip" title={s}>🖼 {alt || s.split("/").pop()}</span>;
}

/** The parts of a [link](url "title"), ![image](src) or [link][ref]: its words' range, where it goes. */
function linkParts(c: Ctx, n: SyntaxNode) {
  const ks = kids(n);
  const marks = ks.filter((k) => k.name === "LinkMark");
  const open = marks[0];
  const close = marks.find((m) => text(c, m.from, m.to) === "]");
  const from = open ? open.to : n.from;
  const to = close ? close.from : n.to;
  const urlNode = ks.find((k) => k.name === "URL");
  const titleNode = ks.find((k) => k.name === "LinkTitle");
  const label = ks.find((k) => k.name === "LinkLabel");
  let url = urlNode ? text(c, urlNode.from, urlNode.to) : null;
  let title = titleNode ? text(c, titleNode.from + 1, titleNode.to - 1) : undefined;
  if (url === null) {
    const ref = c.refs.get(refKey(label ? text(c, label.from, label.to) : text(c, from, to)));
    if (ref) {
      url = ref.url;
      title ??= ref.title;
    }
  }
  return { from, to, url, title };
}

/** The inline content of a node between two points: its text, with each inline node drawn. */
function inline(c: Ctx, n: SyntaxNode, from = n.from, to = n.to): ReactNode[] {
  const out: ReactNode[] = [];
  let at = from;
  for (const k of kids(n)) {
    if (k.to <= from || k.from >= to) continue;
    if (k.from > at) out.push(text(c, at, k.from));
    out.push(inlineNode(c, k));
    at = Math.max(at, k.to);
  }
  if (at < to) out.push(text(c, at, to));
  return out;
}

function inlineNode(c: Ctx, n: SyntaxNode): ReactNode {
  const key = c.key++;
  switch (n.name) {
    case "Emphasis":
      return <em key={key}>{inline(c, n)}</em>;
    case "StrongEmphasis":
      return <strong key={key}>{inline(c, n)}</strong>;
    case "Strikethrough":
      return <del key={key}>{inline(c, n)}</del>;
    case "InlineCode": {
      const marks = kids(n).filter((k) => k.name === "CodeMark");
      const body = text(c, marks[0]?.to ?? n.from, marks.at(-1)?.from ?? n.to);
      return <code key={key}>{body.length > 2 && body.startsWith(" ") && body.endsWith(" ") ? body.slice(1, -1) : body}</code>;
    }
    case "Link": {
      const l = linkParts(c, n);
      if (l.url === null) return <span key={key}>{text(c, n.from, n.to)}</span>;
      return <Anchor key={key} c={c} url={l.url} title={l.title}>{inline(c, n, l.from, l.to)}</Anchor>;
    }
    case "Image": {
      const l = linkParts(c, n);
      const alt = text(c, l.from, l.to);
      return l.url === null ? <span key={key}>{text(c, n.from, n.to)}</span> : <Img key={key} src={l.url} alt={alt} title={l.title} />;
    }
    case "Autolink":
    case "URL": {
      const u = n.name === "Autolink" ? text(c, n.from + 1, n.to - 1) : text(c, n.from, n.to);
      const href = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(u) ? `mailto:${u}` : /^www\./i.test(u) ? `https://${u}` : u;
      return <Anchor key={key} c={c} url={href}>{u}</Anchor>;
    }
    case "HardBreak":
      return <br key={key} />;
    case "Escape":
      return text(c, n.from + 1, n.to);
    case "Entity":
      return entity(text(c, n.from, n.to));
    case "HTMLTag":
      return /^<br\s*\/?>$/i.test(text(c, n.from, n.to)) ? <br key={key} /> : null;
    case "Comment":
      return null;
    default:
      return MARKS.has(n.name) ? null : <span key={key}>{inline(c, n)}</span>;
  }
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <div className="mdp-code">
      <div className="mdp-codebar">
        <span>{lang}</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>
          {lines.map((line, i) => (
            <span key={i}>
              {line.map((s, j) => (s.cls ? <span key={j} className={s.cls}>{s.text}</span> : s.text))}
              {i < lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** GitHub's alerts: a quote that starts with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION]. */
const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const ALERT_ICON: Record<string, string> = { note: "ℹ", tip: "💡", important: "❗", warning: "⚠", caution: "⛔" };

function cellsOf(c: Ctx, row: SyntaxNode): (SyntaxNode | null)[] {
  const out: (SyntaxNode | null)[] = [];
  let col = 0;
  let started = !text(c, row.from, row.to).trimStart().startsWith("|");
  for (const k of kids(row)) {
    if (k.name === "TableDelimiter") {
      if (started) col++;
      else started = true;
    } else if (k.name === "TableCell") {
      out[col] = k;
      started = true;
    }
  }
  return out;
}

/** An HTML block (a centred logo, badges, a <details>): its pictures and its words, never its markup. */
function htmlBlock(html: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  let k = 0;
  for (const m of html.matchAll(/<img\b[^>]*>|<br\s*\/?>|<[^>]+>|[^<]+/gi)) {
    const t = m[0];
    if (/^<img\b/i.test(t)) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(t)?.[1];
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(t)?.[1] ?? "";
      if (src) parts.push(<Img key={k++} src={src} alt={alt} />);
    } else if (/^<br/i.test(t)) parts.push(<br key={k++} />);
    else if (!t.startsWith("<")) parts.push(t.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (e) => entity(e)));
  }
  return parts.some((p) => typeof p !== "string" || p.trim()) ? <div key={key} className="mdp-html">{parts}</div> : null;
}

function block(c: Ctx, n: SyntaxNode): ReactNode {
  const key = c.key++;
  const name = n.name;
  const heading = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(name);
  if (heading) {
    const level = Number(heading[1]);
    const id = slug(c, plain(c, n).replace(/^#+|#+\s*$/g, ""));
    const H = `h${level}` as "h1";
    return <H key={key} data-id={id}>{inline(c, n)}</H>;
  }
  switch (name) {
    case "Paragraph":
      return <p key={key}>{inline(c, n)}</p>;
    case "FencedCode": {
      const ks = kids(n);
      const info = ks.find((k) => k.name === "CodeInfo");
      const body = ks.find((k) => k.name === "CodeText");
      const lang = info ? text(c, info.from, info.to).trim().split(/[\s{]/)[0] : "";
      return <CodeBlock key={key} code={body ? text(c, body.from, body.to) : ""} lang={lang} />;
    }
    case "CodeBlock": {
      const start = c.src.lastIndexOf("\n", n.from - 1) + 1;
      const code = text(c, start, n.to).split("\n").map((l) => l.replace(/^( {1,4}|\t)/, "")).join("\n");
      return <CodeBlock key={key} code={code} lang="" />;
    }
    case "Blockquote": {
      const inner = kids(n).filter((k) => !MARKS.has(k.name));
      const first = inner[0];
      const alert = first?.name === "Paragraph" ? ALERT.exec(text(c, first.from, first.to)) : null;
      if (alert && first) {
        const kind = alert[1].toLowerCase();
        const rest = first.from + alert[0].length;
        return (
          <div key={key} className={`mdp-alert ${kind}`}>
            <p className="mdp-alert-title">{ALERT_ICON[kind]} {kind[0].toUpperCase() + kind.slice(1)}</p>
            {rest < first.to && <p>{inline(c, first, rest, first.to)}</p>}
            {inner.slice(1).map((k) => block(c, k))}
          </div>
        );
      }
      return <blockquote key={key}>{inner.map((k) => block(c, k))}</blockquote>;
    }
    case "BulletList":
      return <ul key={key}>{kids(n).map((k) => block(c, k))}</ul>;
    case "OrderedList": {
      const mark = kids(kids(n)[0] ?? n).find((k) => k.name === "ListMark");
      const start = mark ? parseInt(text(c, mark.from, mark.to), 10) : 1;
      return <ol key={key} start={Number.isFinite(start) && start !== 1 ? start : undefined}>{kids(n).map((k) => block(c, k))}</ol>;
    }
    case "ListItem": {
      const inner = kids(n).filter((k) => k.name !== "ListMark");
      const task = inner.find((k) => k.name === "Task");
      if (task) {
        const marker = kids(task).find((k) => k.name === "TaskMarker");
        const done = marker ? /x/i.test(text(c, marker.from, marker.to)) : false;
        return (
          <li key={key} className="mdp-task">
            <input type="checkbox" checked={done} readOnly tabIndex={-1} aria-label={done ? "Done" : "Not done"} />
            <span>{inline(c, task)}</span>
            {inner.filter((k) => k !== task).map((k) => block(c, k))}
          </li>
        );
      }
      return <li key={key}>{inner.map((k) => block(c, k))}</li>;
    }
    case "HorizontalRule":
      return <hr key={key} />;
    case "Table": {
      const rows = kids(n);
      const delim = rows.find((k) => k.name === "TableDelimiter" && /-/.test(text(c, k.from, k.to)));
      const align = (delim ? text(c, delim.from, delim.to) : "")
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((d) => {
          const t = d.trim();
          return t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : t.startsWith(":") ? "left" : undefined;
        });
      const cols = Math.max(align.length, 1);
      const head = rows.find((k) => k.name === "TableHeader");
      const body = rows.filter((k) => k.name === "TableRow");
      const cells = (row: SyntaxNode, Tag: "th" | "td") => {
        const cs = cellsOf(c, row);
        return Array.from({ length: cols }, (_, i) => (
          <Tag key={i} style={align[i] ? { textAlign: align[i] } : undefined}>{cs[i] ? inline(c, cs[i]!) : null}</Tag>
        ));
      };
      return (
        <div key={key} className="mdp-table">
          <table>
            {head && <thead><tr>{cells(head, "th")}</tr></thead>}
            <tbody>{body.map((r, i) => <tr key={i}>{cells(r, "td")}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case "HTMLBlock":
      return htmlBlock(text(c, n.from, n.to), key);
    case "LinkReference":
    case "CommentBlock":
    case "ProcessingInstructionBlock":
      return null;
    case "Task":
      return <p key={key}>{inline(c, n)}</p>;
    default:
      return kids(n).length ? <div key={key}>{kids(n).map((k) => block(c, k))}</div> : <p key={key}>{text(c, n.from, n.to)}</p>;
  }
}

/** Every [label]: url "title" in the file, for [text][label] links. */
function references(src: string, root: SyntaxNode): Map<string, Ref> {
  const refs = new Map<string, Ref>();
  const walk = (n: SyntaxNode) => {
    for (const k of kids(n)) {
      if (k.name === "LinkReference") {
        const ks = kids(k);
        const label = ks.find((x) => x.name === "LinkLabel");
        const url = ks.find((x) => x.name === "URL");
        const title = ks.find((x) => x.name === "LinkTitle");
        if (label && url) {
          const key = refKey(src.slice(label.from, label.to));
          if (!refs.has(key)) refs.set(key, { url: src.slice(url.from, url.to), ...(title ? { title: src.slice(title.from + 1, title.to - 1) } : {}) });
        }
      } else if (k.name === "Blockquote" || k.name.endsWith("List") || k.name === "ListItem") walk(k);
    }
  };
  walk(root);
  return refs;
}

/** Markdown longer than this is shown as text: drawing it all would hold the page up. */
const MAX = 400_000;

/** A Markdown file as React elements (hooks only inside the code blocks and links it holds). */
export function renderMarkdown(src: string, path: string, onOpen?: (path: string) => void): ReactNode {
  if (src.length > MAX) return <pre className="mdp-plain">{src}</pre>;
  const root = parser.parse(src).topNode;
  const c: Ctx = { src, refs: references(src, root), dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", onOpen, ids: new Map(), key: 0 };
  return kids(root).map((k) => block(c, k));
}

export function MarkdownBody({ text: src, path, onOpen }: { text: string; path: string; onOpen?: (path: string) => void }) {
  const body = useMemo(() => renderMarkdown(src, path, onOpen), [src, path, onOpen]);
  return <article className="mdp" aria-label={`${path.split("/").pop()} as it reads`}>{body}</article>;
}
