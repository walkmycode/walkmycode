// A course's study material opened from disk as the Markdown a lesson is read
// from (src/learn/lib/docText.ts does the turning): Markdown and plain text as
// they are, a Word document's and PowerPoint slides' text out of their zip, a
// PDF's text pages through unpdf. Text only, and only from files of a sensible
// size. A file that cannot be read is said to be unreadable, never guessed at.
import "server-only";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { inflateRawSync } from "node:zlib";
import { titleOfDir } from "@/learn/lib/courseFolder";
import { docxToMarkdown, plainToMarkdown, slideToMarkdown } from "@/learn/lib/docText";

/** The largest document opened (a scanned textbook is larger, and has no text to read anyway). */
export const DOC_MAX = 12 * 1024 * 1024;
/** The most text kept from one document: a lesson is taught from far less. */
export const TEXT_MAX = 160_000;
/** The most a single file inside a .docx or .pptx may unpack to. */
const ENTRY_MAX = 24 * 1024 * 1024;

/**
 * The files inside a zip (a .docx or .pptx), by name: read from its central directory, stored or deflated entries
 * only. `want` picks the entries to unpack, so a deck's pictures are never inflated.
 */
export function unzip(zip: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // The end-of-central-directory record is in the last 64 KB.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) break;
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (!want(name) || size > ENTRY_MAX || local + 30 > zip.length) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + packed);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: ENTRY_MAX }));
  }
  return out;
}

const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}\n\n… (the rest of this document was not read)` : s);
const titleOf = (name: string) => titleOfDir(name.replace(/\.[A-Za-z0-9]+$/, ""));
const tooLarge = (name: string) => ({ unreadable: `${name} is larger than ${DOC_MAX / 1024 / 1024} MB.` });

/** A PDF's text, page after page. Null for a PDF with no text in it (a scan). */
async function pdfText(bytes: Buffer): Promise<string | null> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((p) => p.trim()).filter(Boolean);
  return pages.length ? pages.join("\n\n") : null;
}

export type ReadDoc = { text: string } | { unreadable: string };

// A PDF's text takes a moment and a promise to get; everything else is read at once. So a course's PDFs are read
// ahead (primePdfs), and kept by path, size and date, for the walk that follows to find them ready.
const pdfs = new Map<string, ReadDoc>();
const pdfKey = (file: string) => {
  const st = statSync(file);
  return [file, st.size, st.mtimeMs].join("|");
};

/** Read these PDFs' text ahead of a walk of the course. The others in the list are ignored. */
export async function primePdfs(files: string[]): Promise<void> {
  for (const file of files) {
    if (!/\.pdf$/i.test(file)) continue;
    const name = basename(file);
    try {
      const key = pdfKey(file);
      if (pdfs.has(key)) continue;
      if (pdfs.size > 300) pdfs.clear();
      if (statSync(file).size > DOC_MAX) {
        pdfs.set(key, tooLarge(name));
        continue;
      }
      const text = await pdfText(readFileSync(file));
      pdfs.set(key, text ? { text: clip(plainToMarkdown(text, titleOf(name))) } : { unreadable: `${name} has no text in it (a scanned PDF is pictures of pages).` });
    } catch {
      // Left out: readDoc says it could not be read.
    }
  }
}

/** One file of a course as Markdown, whatever it was written in. A PDF must have been read ahead (primePdfs). */
export function readDoc(file: string): ReadDoc {
  const name = basename(file);
  const title = titleOf(name);
  try {
    if (/\.pdf$/i.test(name)) return pdfs.get(pdfKey(file)) ?? { unreadable: `${name} could not be read.` };
    if (statSync(file).size > DOC_MAX) return tooLarge(name);
    const bytes = readFileSync(file);
    if (/\.(md|markdown)$/i.test(name)) return { text: clip(bytes.toString("utf8")) };
    if (/\.txt$/i.test(name)) return { text: clip(plainToMarkdown(bytes.toString("utf8"), title)) };
    if (/\.docx$/i.test(name)) {
      const xml = unzip(bytes, (n) => n === "word/document.xml").get("word/document.xml");
      if (!xml) return { unreadable: `${name} has no document text in it.` };
      const md = docxToMarkdown(xml.toString("utf8"));
      return md ? { text: clip(/^# /m.test(md) ? md : `# ${title}\n\n${md}`) } : { unreadable: `${name} has no text in it.` };
    }
    if (/\.pptx$/i.test(name)) {
      const slides = [...unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).entries()]
        .map(([n, xml]) => ({ n: Number(/slide(\d+)\.xml$/.exec(n)![1]), xml: xml.toString("utf8") }))
        .sort((a, b) => a.n - b.n);
      const md = slides.map((x) => slideToMarkdown(x.xml, x.n));
      return md.length ? { text: clip(`# ${title}\n\n${md.join("\n\n")}`) } : { unreadable: `${name} has no text on its slides.` };
    }
    return { unreadable: `${name} is not a kind of file Learn reads.` };
  } catch {
    return { unreadable: `${name} could not be read.` };
  }
}
