// A course in whatever its author wrote it in (docs/COURSES.md): Word,
// PowerPoint, PDF and plain text read as lessons (src/learn/lib/docText.ts,
// src/lib/learnDocs.ts), question papers matched to their answer keys and mark
// schemes, a flat folder of documents as an outline, point-by-point marking,
// and the analogy scene for a subject without code. The Word, PowerPoint and
// PDF files are made here, small and real.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { readPaper } from "../src/learn/lib/courseFolder";
import { docxToMarkdown, numberOf, partnerOf, plainToMarkdown, roleOf, slideToMarkdown, stemOf } from "../src/learn/lib/docText";
import { cleanPoints, PERSONA, writtenCheckPrompt } from "../src/learn/lib/professor";
import { cleanScene, sceneLanguage, scenePrompt } from "../src/learn/lib/scene";
import { DEFAULT_PROFILE, type Board, type Lesson } from "../src/learn/lib/types";
import { findLessons, loadLesson, loadOutline, prime, sortDocs } from "../src/lib/learnCourse";
import { readDoc, unzip } from "../src/lib/learnDocs";

// ── small real files ──

/** A zip with these files, the first stored and the rest deflated, as Word and PowerPoint write them. */
function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const raw = Buffer.from(text, "utf8");
    const data = i === 0 ? raw : deflateRawSync(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(i === 0 ? 0 : 8, 8);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(Buffer.byteLength(name), 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(i === 0 ? 0 : 8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(Buffer.byteLength(name), 28);
    entry.writeUInt32LE(offset, 42);
    local.push(head, Buffer.from(name), data);
    central.push(entry, Buffer.from(name));
    offset += 30 + Buffer.byteLength(name) + data.length;
  });
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

const wp = (text: string, style = "", list = false) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${list ? "<w:numPr><w:ilvl w:val=\"0\"/></w:numPr>" : ""}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx = (...paragraphs: string[]) => zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<?xml version="1.0"?><w:document><w:body>${paragraphs.join("")}</w:body></w:document>`, "word/media/image1.png": "not text" });
const slide = (title: string, ...lines: string[]) =>
  `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

/** A one-page PDF saying these lines, written by hand: enough for a real PDF reader to find its text. */
function pdf(lines: string[]): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objects.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("documents as Markdown", () => {
  it("reads a Word document's headings, paragraphs and lists", () => {
    const xml = `<w:body>${wp("Fractions", "Title")}${wp("A fraction is a part of a whole.")}${wp("Adding fractions", "Heading1")}${wp("Same bottom number: add the tops &amp; keep the bottom.")}${wp("Find a common bottom number", "", true)}${wp("Add the tops", "", true)}${wp("")}${wp("Harder cases", "Heading2")}${wp("3. Already numbered", "", true)}</w:body>`;
    assert.equal(
      docxToMarkdown(xml),
      "# Fractions\n\nA fraction is a part of a whole.\n\n## Adding fractions\n\nSame bottom number: add the tops & keep the bottom.\n\n1. Find a common bottom number\n2. Add the tops\n\n### Harder cases\n\n3. Already numbered",
    );
    assert.equal(docxToMarkdown("<w:body><w:p><w:r><w:t>one</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three &lt;b&gt; &#233;</w:t></w:r></w:p></w:body>"), "one\ttwo\nthree <b> é");
    assert.equal(docxToMarkdown("<w:body></w:body>"), "");
  });

  it("reads a slide as a section: its title, then its lines", () => {
    assert.equal(slideToMarkdown(slide("The heart", "Four chambers", "Two sides"), 2), "## The heart\n\n- Four chambers\n- Two sides");
    assert.equal(slideToMarkdown("<p:sld><p:sp><p:txBody><a:p><a:r><a:t>No title shape</a:t></a:r></a:p><a:p><a:r><a:t>a line</a:t></a:r></a:p></p:txBody></p:sp></p:sld>", 3), "## No title shape\n\n- a line");
    assert.equal(slideToMarkdown("<p:sld></p:sld>", 7), "## Slide 7");
  });

  it("finds the headings in plain text and joins the lines a page broke", () => {
    const md = plainToMarkdown("CAUSES OF THE WAR\n\nFour long-term causes made a regional\ncrisis into a world war. Histor-\nians still argue.\n\n1.1 Alliances\n\nTwo blocs.\n\n- a list item\n1. a numbered question\n\nChapter 2: The spark\n\nOne shot in Sarajevo.\n", "Fallback");
    assert.equal(md, "# Causes of the war\n\nFour long-term causes made a regional crisis into a world war. Historians still argue.\n\n## 1.1 Alliances\n\nTwo blocs.\n\n- a list item\n1. a numbered question\n\n## Chapter 2: The spark\n\nOne shot in Sarajevo.");
    assert.equal(plainToMarkdown("Just a sentence, nothing else.", "My notes"), "# My notes\n\nJust a sentence, nothing else.");
    assert.doesNotMatch(plainToMarkdown("x\n\nTHIS IS A VERY LONG LINE IN CAPITALS THAT IS A SENTENCE NOT A HEADING AT ALL, REALLY.\n", "t"), /^## /m);
  });
});

describe("question papers and their answers, by name", () => {
  it("tells a paper from a key from a lesson", () => {
    for (const n of ["03_causes_questions.md", "Past Paper 2019.pdf", "worksheet-2.docx", "homework.txt", "Problems 4.pdf", "exam.pdf"]) assert.equal(roleOf(n), "questions", n);
    for (const n of ["03_causes_answers.md", "Past Paper 2019 Mark Scheme.pdf", "worksheet-2-solutions.docx", "answer key.txt", "questions_answers.md"]) assert.equal(roleOf(n), "answers", n);
    for (const n of ["03_causes.md", "Lecture 4.pptx", "notes.txt", "The contest for Africa.pdf"]) assert.equal(roleOf(n), "lesson", n);
  });

  it("knows what a file is about once its number and its role are taken away", () => {
    assert.equal(stemOf("03_causes_questions.md"), "causes");
    assert.equal(stemOf("Past Paper 2019 Mark Scheme.pdf"), "2019");
    assert.equal(stemOf("worksheet-2-solutions.docx"), "2");
    assert.equal(numberOf("03_causes.md"), 3);
    assert.equal(numberOf("causes.md"), null);
  });

  it("pairs by number first, then by subject, then when there is only one", () => {
    assert.equal(partnerOf("03_answers.md", ["02_questions.md", "03_questions.md"]), "03_questions.md");
    assert.equal(partnerOf("fractions mark scheme.pdf", ["algebra questions.pdf", "fractions questions.pdf"]), "fractions questions.pdf");
    assert.equal(partnerOf("mark scheme.pdf", ["past paper.pdf"]), "past paper.pdf");
    assert.equal(partnerOf("mark scheme.pdf", ["paper a.pdf", "paper b.pdf"]), null, "no guessing between two");
    assert.equal(partnerOf("03_answers.md", ["01_questions.md", "02_questions.md"]), null, "a number that matches nothing pairs with nothing");
  });

  it("sorts a folder's documents: lessons, the papers that go with them, and each paper's key", () => {
    const flat = sortDocs(["causes.md", "causes questions.md", "causes answers.md", "past paper 2019.pdf", "past paper 2019 mark scheme.pdf", "glossary.txt"], false);
    assert.deepEqual(flat.lessons, ["causes.md", "glossary.txt", "past paper 2019.pdf"], "in a folder with no numbers every document is a lesson, and a paper with no lesson is one too");
    assert.deepEqual([...flat.papers], [["causes.md", ["causes questions.md"]]]);
    assert.deepEqual([...flat.keys].sort(), [["causes questions.md", "causes answers.md"], ["past paper 2019.pdf", "past paper 2019 mark scheme.pdf"]]);
    const numbered = sortDocs(["01_intro.md", "02_causes.docx", "02_questions.md", "02_answers.md", "notes.md", "revision questions.md"], true);
    assert.deepEqual(numbered.lessons, ["01_intro.md", "02_causes.docx"], "where things are numbered, the unnumbered are left out");
    assert.deepEqual([...numbered.papers], [["02_causes.docx", ["02_questions.md"]]]);
    assert.deepEqual([...numbered.keys], [["02_questions.md", "02_answers.md"]]);
  });

  it("makes one exercise per numbered question, answered by the key's entry of the same number", () => {
    const ex = readPaper("02_questions.md", "# Fractions: practice\n\n1. Work out 1/2 + 1/4.\n2. Explain why you cannot add 1/2 and 1/3 straight away.\n   Use a picture.\n3. Work out 2/3 of 12.", "# Answers\n\n1. 3/4 (M1 for a common bottom number, A1 for 3/4)\n3. 8");
    assert.deepEqual(ex.map((e) => [e.title, e.kind, e.solution]), [
      ["Fractions: practice: question 1", "written", "3/4 (M1 for a common bottom number, A1 for 3/4)"],
      ["Fractions: practice: question 2", "written", undefined],
      ["Fractions: practice: question 3", "written", "8"],
    ]);
    assert.equal(ex[1].task, "Explain why you cannot add 1/2 and 1/3 straight away.\nUse a picture.");
  });

  it("gives a mark scheme that is not numbered to every question, and treats a paper with no numbers as one question", () => {
    const scheme = "Level 3: explains at least two causes and links them. Level 1: lists causes.";
    const ex = readPaper("essay questions.md", "1. Why did war break out?\n2. Was it inevitable?", scheme);
    assert.deepEqual(ex.map((e) => e.solution), [scheme, scheme]);
    const one = readPaper("Essay question.txt", "# Essay\n\nWas the war inevitable? Argue both sides.", scheme);
    assert.deepEqual([one.length, one[0].title, one[0].name, one[0].solution], [1, "Essay", "Essay question.txt", scheme]);
    assert.deepEqual(readPaper("empty questions.md", "# Only a title\n"), []);
  });
});

describe("a course of documents on disk", () => {
  let root: string;
  const put = (path: string, data: string | Buffer) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "walkmycode-docs-"));
    // A flat folder, nothing numbered: a biology revision folder.
    put("biology/The heart.pptx", zip({ "[Content_Types].xml": "<Types/>", "ppt/slides/slide2.xml": slide("Blood flow", "Right side to the lungs", "Left side to the body"), "ppt/slides/slide1.xml": slide("The heart", "A pump with four chambers"), "ppt/slides/slide10.xml": slide("Summary", "Two pumps in one"), "ppt/media/image1.png": "x".repeat(2000) }));
    put("biology/Cells.txt", "CELLS\n\nEvery living thing is made of cells.\n\n1.1 The nucleus\n\nIt holds the instructions.\n");
    put("biology/Heart questions.md", "1. Name the four chambers.\n2. Which side pumps to the lungs?\n");
    put("biology/Heart answers.md", "1. Left and right atria, left and right ventricles.\n2. The right side.\n");
    put("biology/.hidden.md", "# secret\n");
    put("biology/photo.jpg", "not a document");
    // A maths unit with numbered files: a Word lesson, a PDF paper, a mark scheme.
    put("maths/01_fractions.docx", docx(wp("Fractions", "Title"), wp("A fraction is a part of a whole."), wp("Adding fractions", "Heading1"), wp("Make the bottom numbers the same, then add the tops.")));
    put("maths/01_fractions_questions.pdf", pdf(["Fractions practice", "", "1. Work out 1/2 + 1/4.", "2. Work out 2/3 of 12."]));
    put("maths/01_fractions_mark_scheme.md", "1. 3/4. M1 common bottom number of 4; A1 3/4.\n2. 8. M1 12 divided by 3; A1 8.\n");
    put("maths/02_past_paper.pdf", pdf(["1. Simplify 6/8.", "2. Work out 3/5 + 1/5."]));
    put("maths/notes.md", "# Teacher's notes\n");
    put("maths/scan.pdf", Buffer.from("%PDF-1.4\nnot really a pdf"));
    await prime(root);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("opens only the entries it wants from a zip, stored or deflated", () => {
    const z = zip({ "a.txt": "stored", "word/document.xml": "<w:body/>", "word/media/big.png": "x".repeat(5000) });
    const got = unzip(z, (n) => n.endsWith(".xml") || n === "a.txt");
    assert.deepEqual([...got.keys()], ["a.txt", "word/document.xml"]);
    assert.equal(got.get("a.txt")!.toString(), "stored");
    assert.equal(got.get("word/document.xml")!.toString(), "<w:body/>");
    assert.throws(() => unzip(Buffer.from("not a zip at all"), () => true), /not a zip/);
  });

  it("reads a Word file, a deck in slide order, a text file and a PDF's text", () => {
    const text = (path: string) => {
      const got = readDoc(join(root, path));
      assert.ok("text" in got, `${path}: ${"unreadable" in got ? got.unreadable : ""}`);
      return got.text;
    };
    assert.equal(text("maths/01_fractions.docx"), "# Fractions\n\nA fraction is a part of a whole.\n\n## Adding fractions\n\nMake the bottom numbers the same, then add the tops.");
    assert.equal(text("biology/The heart.pptx"), "# The heart\n\n## The heart\n\n- A pump with four chambers\n\n## Blood flow\n\n- Right side to the lungs\n- Left side to the body\n\n## Summary\n\n- Two pumps in one");
    assert.match(text("biology/Cells.txt"), /^# Cells\n\nEvery living thing is made of cells\.\n\n## 1\.1 The nucleus/);
    const paper = text("maths/01_fractions_questions.pdf");
    assert.match(paper, /Fractions practice/);
    assert.match(paper, /1\. Work out 1\/2 \+ 1\/4\./);
    assert.match(paper, /2\. Work out 2\/3 of 12\./);
  });

  it("says a file is unreadable rather than guess: a broken PDF, a picture", () => {
    assert.deepEqual(readDoc(join(root, "maths/scan.pdf")), { unreadable: "scan.pdf could not be read." });
    assert.deepEqual(readDoc(join(root, "biology/photo.jpg")), { unreadable: "photo.jpg is not a kind of file Learn reads." });
    assert.deepEqual(readDoc(join(root, "biology/nothing.docx")), { unreadable: "nothing.docx could not be read." });
  });

  it("makes an outline of a flat folder: every document a lesson, the question paper with its lesson", () => {
    assert.deepEqual(findLessons(join(root, "biology")), ["Cells.txt", "The heart.pptx"]);
    const o = loadOutline(join(root, "biology"));
    assert.deepEqual(o.units.map((u) => [u.title, u.lessons.map((l) => [l.title, l.sections, l.exercises])]), [["Lessons", [["Cells", 1, 0], ["The heart", 3, 2]]]]);
    const heart = loadLesson(join(root, "biology"), "The heart.pptx");
    assert.deepEqual(heart.exercises.map((e) => [e.task, e.solution]), [["Name the four chambers.", "Left and right atria, left and right ventricles."], ["Which side pumps to the lungs?", "The right side."]]);
    assert.doesNotMatch(heart.readme, /atria/, "the answers are not in what is taught");
  });

  it("reads a numbered unit: the Word lesson with its PDF paper and mark scheme, a past paper as a lesson of its own", () => {
    assert.deepEqual(findLessons(join(root, "maths")), ["01_fractions.docx", "02_past_paper.pdf"], "the mark scheme, the notes and the broken scan are not lessons");
    const fractions = loadLesson(root, "maths/01_fractions.docx");
    assert.deepEqual([fractions.title, fractions.unit, fractions.sections], ["Fractions", "Maths", ["Adding fractions"]]);
    assert.deepEqual(fractions.exercises.map((e) => [e.task, e.solution]), [
      ["Work out 1/2 + 1/4.", "3/4. M1 common bottom number of 4; A1 3/4."],
      ["Work out 2/3 of 12.", "8. M1 12 divided by 3; A1 8."],
    ]);
    const paper = loadLesson(root, "maths/02_past_paper.pdf");
    assert.equal(paper.title, "Past paper");
    assert.deepEqual(paper.exercises.map((e) => e.task), ["Simplify 6/8.", "Work out 3/5 + 1/5."]);
    assert.match(paper.readme, /A paper of 2 questions to practise with/);
    assert.deepEqual(paper.checklist, ["Simplify 6/8.", "Work out 3/5 + 1/5."]);
  });

  it("puts the whole course together: units from folders, lessons from documents", () => {
    const o = loadOutline(root);
    assert.deepEqual(o.units.map((u) => [u.title, u.lessons.map((l) => l.id)]), [["Biology", ["biology/Cells.txt", "biology/The heart.pptx"]], ["Maths", ["maths/01_fractions.docx", "maths/02_past_paper.pdf"]]]);
  });

  it("never opens a hidden file or a file that is not a document as a lesson", () => {
    assert.throws(() => loadLesson(root, "biology/.hidden.md"), /not in the course folder/);
    assert.throws(() => loadLesson(root, "biology/photo.jpg"), /not in the course folder/);
    assert.doesNotMatch(JSON.stringify(loadOutline(root)), /secret/);
  });
});

describe("marking against a mark scheme", () => {
  const board: Board = { title: "Question 1", kind: "write", lines: [], task: "Work out 1/2 + 1/4.", solution: "3/4. M1 common bottom number of 4; A1 3/4." };
  const lesson: Lesson = { id: "L", course: "Maths", number: 1, title: "Fractions", subject: "Fractions", summary: "s", boards: [{ title: "Adding", kind: "talk", lines: [{ w: "Same bottom number", s: "x" }], analogy: "Slices of the same pizza." }, board], createdAt: 0, updatedAt: 0, at: 0, seen: [0] };

  it("asks for each of the scheme's points, a calculation's answer before its working, and an essay's ideas", () => {
    const p = writtenCheckPrompt(lesson, board, "2/4 + 1/4 = 3/4", DEFAULT_PROFILE);
    assert.match(p, /mark each one: "points" has one entry per point/);
    assert.match(p, /never the scheme's own wording/);
    assert.match(p, /check the final answer against the scheme first, then the working/);
    assert.match(p, /without giving the right value/);
    assert.match(p, /An essay or short answer is judged by the ideas it has/);
    assert.match(p, /"points": \[\{"point"/);
  });

  it("keeps the points the professor marked, when they are well formed", () => {
    assert.deepEqual(cleanPoints([{ point: " A common bottom number ", met: true, note: "You used quarters." }, { point: "", met: true }, { point: "The final answer", met: "yes", note: 7 }, "junk"]), [
      { point: "A common bottom number", met: true, note: "You used quarters." },
      { point: "The final answer", met: false, note: "" },
    ]);
    assert.deepEqual(cleanPoints(undefined), []);
    assert.equal(cleanPoints(Array.from({ length: 30 }, (_, i) => ({ point: `p${i}`, met: true }))).length, 12);
  });

  it("draws the analogy scene for a subject without code from the real steps, not a program", () => {
    assert.equal(sceneLanguage(lesson), null);
    const p = scenePrompt(lesson, 0, DEFAULT_PROFILE);
    assert.match(p, /the real thing, in this subject's own terms, on the right/);
    assert.match(p, /"code": the real steps, 3 to 8 short lines in this subject's own words/);
    assert.match(p, /not code and not the analogy/);
    assert.doesNotMatch(p, /compiler|variable or a function/);
    const scene = cleanScene({ title: "Slices of one pizza", place: "a kitchen", actors: [{ id: "emily", a: "Emily", r: "the first fraction" }, { id: "plate", a: "the plate", r: "the total" }], things: [{ id: "slice", a: "two slices", r: "2/4" }], code: "Write 1/2 as 2/4.\nAdd 2/4 and 1/4.", steps: [{ line: 1, holds: { slice: "emily" }, a: "Emily cuts her half in two.", r: "1/2 becomes 2/4." }, { line: 2, holds: { slice: "plate" }, a: "The slices go on one plate.", r: "2/4 + 1/4 = 3/4." }], map: [{ a: "a slice", r: "a quarter" }], rule: "Same size pieces first.", breaks: "Pizzas are never cut exactly." }, null)!;
    assert.equal(scene.plain, true);
    assert.equal(scene.code, "Write 1/2 as 2/4.\nAdd 2/4 and 1/4.");
    // A lesson with code still gets the code on the right.
    const coded: Lesson = { ...lesson, boards: [...lesson.boards, { title: "ex", kind: "code", lines: [], task: "t", starter: "fn main() {}", language: "rust" }] };
    assert.equal(sceneLanguage(coded), "rust");
    assert.match(scenePrompt(coded, 0, DEFAULT_PROFILE), /the real rust code on the right/);
    assert.equal(cleanScene({ ...scene, language: undefined }, "rust")!.plain, undefined);
  });

  it("sets the professor's examples in the United Kingdom", () => {
    assert.match(PERSONA, /set in the United Kingdom: British first names \(Emily, Jack/);
    assert.match(PERSONA, /pounds and pence/);
    assert.match(PERSONA, /a queue at a bus stop, a London bus/);
    assert.doesNotMatch(scenePrompt(lesson, 0, DEFAULT_PROFILE), /Ama|Kofi|Accra|cedi/);
  });
});
