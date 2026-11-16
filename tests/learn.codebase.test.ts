// A Learn request that names a codebase on this computer, or asks for diagrams by name
// (src/learn/lib/codebaseAsk.ts, src/lib/learnCodebase.ts). The owner (15 Nov) asked for
// "how payment gateway in fintech work, especially in kola 'codebase in myenvironment … v2'"
// in UML and got a tuck shop over made-up Python: the request is now read for the codebase
// and the diagrams, the folder is found by name or path and read (never its secrets), and
// the professor is told to teach from the real files, or that they were not found.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { codebaseAsked, diagramsAsked, groundingPart, groundOf, pathsIn, pickCodebase, sceneGrounding, scoreFolder, topicTerms, type CodebaseLookup } from "../src/learn/lib/codebaseAsk";
import { lessonPrompt, type LessonRequest } from "../src/learn/lib/professor";
import { scenePrompt } from "../src/learn/lib/scene";
import { DEFAULT_PROFILE, type Lesson } from "../src/learn/lib/types";
import { excerpt, findCodebase, learnCodebaseHandler, lookupCodebase } from "../src/lib/learnCodebase";
import { guarded } from "../src/lib/providers/guard";

const OWNER = "use uml diagram to describe how payment gateway in fintech work especially in kola 'codebase in myenvironment … v2'";
const SECRET_VALUE = "sk_live_DO_NOT_READ_123";

describe("what a lesson request asks for", () => {
  it("reads UML, and diagrams by name; a plain subject asks for none", () => {
    assert.deepEqual(diagramsAsked(OWNER), { uml: true, kinds: ["sequence", "class"] });
    assert.deepEqual(diagramsAsked("Draw a sequence diagram of how login works")?.kinds, ["sequence"]);
    assert.deepEqual(diagramsAsked("a class diagram and an ER diagram of the shop")?.kinds, ["class", "er"]);
    assert.deepEqual(diagramsAsked("the state machine of a traffic light")?.kinds, ["state"]);
    assert.deepEqual(diagramsAsked("explain closures with a diagram"), { uml: false, kinds: [] });
    assert.equal(diagramsAsked("SQL joins, explained with a bakery's orders and customers"), null);
    assert.equal(diagramsAsked("How a CPU runs a program, one instruction at a time"), null);
  });

  it("reads the owner's request as a codebase named kola … v2, with payment gateway as the subject", () => {
    const ask = codebaseAsked(OWNER);
    assert.ok(ask);
    assert.deepEqual(ask.paths, []);
    for (const w of ["kola", "v2", "myenvironment"]) assert.ok(ask.words.includes(w), w);
    assert.ok(!ask.words.includes("uml") && !ask.words.includes("codebase"));
    assert.match(ask.phrase, /kola/);
    assert.deepEqual(topicTerms(OWNER, ["kola-merchant-portal-v2", "myenvironment"]), ["payment", "gateway", "fintech"]);
  });

  it("a subject that only mentions a project or a folder is not a codebase on the disk", () => {
    assert.equal(codebaseAsked("Teach me project management for small teams"), null);
    assert.equal(codebaseAsked("How a folder structure works in Linux"), null);
    assert.equal(codebaseAsked("How HTTPS keeps a password safe on its way to a website"), null);
    assert.ok(codebaseAsked("how does auth work in my own project, the shop app"));
    assert.ok(codebaseAsked("explain the checkout in the shop repo"));
  });

  it("finds absolute paths, cut at a quote, with what follows kept for the server to trim", () => {
    assert.deepEqual(pathsIn(String.raw`explain auth in C:\code\shop and its checkout`), [String.raw`C:\code\shop and its checkout`]);
    assert.deepEqual(pathsIn(`look at "~/work/shop" please`), ["~/work/shop"]);
    assert.deepEqual(pathsIn("teach /home/emily/shop."), ["/home/emily/shop"]);
    assert.deepEqual(pathsIn("how does POST /api/learn work"), []);
  });

  it("matches folder names: kola … v2 picks the v2 portal over the Next.js one; common words alone match nothing", () => {
    const words = codebaseAsked(OWNER)!.words;
    const v2 = scoreFolder(words, "kola-merchant-portal-v2");
    const next = scoreFolder(words, "KOLA-MERCHANT-PORTAL-NEXTJS");
    assert.ok(v2 > next && next > 0, `${v2} > ${next}`);
    assert.equal(scoreFolder(["web", "portal", "v2"], "kola-merchant-portal-v2"), 0);
    const { best, near } = pickCodebase(words, [
      { name: "KOLA-MERCHANT-PORTAL-NEXTJS", path: "/p/a" },
      { name: "kola-merchant-portal-v2", path: "/p/b" },
      { name: "ferrisworks", path: "/p/c" },
    ]);
    assert.equal(best?.path, "/p/b");
    assert.deepEqual(near.map((c) => c.path), ["/p/a"]);
    assert.ok(scoreFolder(["shop"], "ShopFrontV2") > 0, "camelCase names are split");
  });
});

describe("finding and reading the codebase on this computer", () => {
  let home = "";
  let data = "";
  const v2 = () => join(home, "myenvironment", "kola-merchant-portal-v2");
  const put = (file: string, text: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const opts = () => ({ home, dataDirs: [data] });

  before(() => {
    home = mkdtempSync(join(tmpdir(), "wmc-codebase-"));
    data = join(home, ".walkmycode");
    put(join(v2(), "package.json"), JSON.stringify({ name: "kola-portal-v2", dependencies: { next: "16.0.0", axios: "1.0.0" } }, null, 2));
    put(
      join(v2(), "src", "components", "collection", "usePaymentGateway.ts"),
      "export type PaymentRequest = { amount: number; msisdn: string };\nexport function usePaymentGateway() {\n  // initiate a payment through the gateway\n  return { initiatePayment: (r: PaymentRequest) => fetch('/payments/collect', { method: 'POST', body: JSON.stringify(r) }) };\n}\n",
    );
    put(join(v2(), "src", "app", "page.tsx"), "export default function Home() { return null; }\n");
    put(join(v2(), "src", "util", "format.ts"), "export const money = (n: number) => n.toFixed(2);\n");
    // Secrets, some named to look like the subject: never read.
    put(join(v2(), ".env"), `PAYMENT_GATEWAY_KEY=${SECRET_VALUE}\n`);
    put(join(v2(), "keys.env"), `PAYMENT_KEY=${SECRET_VALUE}\n`);
    put(join(v2(), "src", "config", "payment-secrets.json"), JSON.stringify({ gateway: SECRET_VALUE }));
    put(join(v2(), "certs", "payment-gateway.pem"), SECRET_VALUE);
    put(join(home, "myenvironment", "KOLA-MERCHANT-PORTAL-NEXTJS", "package.json"), "{}");
    // Explore knows the Next.js portal, so its parent (myenvironment) is searched too.
    const nextjs = join(home, "myenvironment", "KOLA-MERCHANT-PORTAL-NEXTJS");
    put(join(data, "workspaces", "kola-nextjs-1", "workspace.json"), JSON.stringify({ name: "KOLA-MERCHANT-PORTAL-NEXTJS", folders: [nextjs] }));
  });
  after(() => rmSync(home, { recursive: true, force: true }));

  it("finds the folder the owner named, beside one Explore already knows", () => {
    const where = findCodebase(OWNER, opts());
    assert.ok(where && "dir" in where);
    assert.equal(where.dir, v2());
  });

  it("finds a folder named in the home folder's folders too, with no workspace saved", () => {
    const where = findCodebase(OWNER, { home, dataDirs: [join(home, "nothing-here")] });
    assert.ok(where && "dir" in where, JSON.stringify(where));
    assert.equal(where.dir, v2());
  });

  it("takes an absolute path, trimming the words after it, and a folder of projects by the name in it", () => {
    const at = findCodebase(`how do payments work in ${v2()} and its gateway`, opts());
    assert.ok(at && "dir" in at);
    assert.equal(at.dir, v2());
    const inside = findCodebase(`payments in ${join(home, "myenvironment")} kola v2 repo`, opts());
    assert.ok(inside && "dir" in inside);
    assert.equal(inside.dir, v2());
  });

  it("reads the files that matter for the subject, with real names and line numbers, and never a secret", async () => {
    const lookup = await lookupCodebase(OWNER, opts());
    assert.ok("found" in lookup, JSON.stringify(lookup));
    const d = lookup.found;
    assert.equal(d.name, "kola-merchant-portal-v2");
    const paths = d.picked.map((f) => f.path);
    assert.equal(paths[0], "package.json", "the manifest first: what it is built with");
    assert.equal(paths[1], "src/components/collection/usePaymentGateway.ts", "the file about the subject next");
    assert.ok(!paths.some((p) => /\.env$|\.pem$|secret/i.test(p)), paths.join(", "));
    assert.ok(!JSON.stringify(d).includes(SECRET_VALUE), "no secret is read");
    assert.match(d.folders[0], /^src\/components\/collection \(1\)$/);
    assert.deepEqual(d.terms, ["payment", "gateway", "fintech"]);
  });

  it("says plainly when the named codebase is not there, and where it looked", async () => {
    const lookup = await lookupCodebase("explain payments in my zebrafish codebase", opts());
    assert.ok("missing" in lookup, JSON.stringify(lookup));
    assert.match(lookup.missing.phrase, /zebrafish/);
    assert.ok(lookup.missing.looked.includes(home));
    const gone = await lookupCodebase(`teach payments in ${join(home, "no-such-folder")}`, opts());
    assert.ok("missing" in gone);
    assert.deepEqual(await lookupCodebase("SQL joins with a bakery", opts()), { asked: false });
  });

  it("is a guarded POST, refused on a hosted server", async () => {
    const post = (body: unknown) =>
      guarded(learnCodebaseHandler(opts()))(new Request("http://localhost:3000/api/learn/codebase", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) }));
    const ok = (await (await post({ request: OWNER })).json()) as CodebaseLookup;
    assert.ok("found" in ok);
    assert.equal((await post({ request: 7 })).status, 400);
    process.env.WALKMYCODE_MODE = "hosted";
    try {
      assert.equal((await post({ request: OWNER })).status, 403);
    } finally {
      delete process.env.WALKMYCODE_MODE;
    }
  });

  it("cuts a long file around its first mention of the subject", () => {
    const long = [...Array.from({ length: 400 }, (_, i) => `const filler${i} = ${i};`), "export function chargeCard() { /* payment */ }", ...Array.from({ length: 400 }, (_, i) => `const tail${i} = ${i};`)].join("\n");
    const one = excerpt("src/pay.ts", long, ["payment"], 2_000);
    assert.equal(one.from, 381);
    assert.ok(one.content.includes("chargeCard"));
    assert.ok(one.content.length <= 2_000);
    assert.equal(one.lines, 801);
  });
});

describe("what the professor is told", () => {
  const req: LessonRequest = { topic: OWNER, course: "Kola merchant portal v2", level: "Complete beginner", boards: 10, notes: "" };
  const found: CodebaseLookup = {
    found: {
      name: "kola-merchant-portal-v2",
      path: "C:\\Users\\me\\myenvironment\\kola-merchant-portal-v2",
      files: 378,
      folders: ["src/components/Merchant-collect/collection-and-payout (6)"],
      picked: [{ path: "src/components/Merchant-collect/collection-and-payout/usePaymentGateway.ts", content: "export function usePaymentGateway() {\n  return null;\n}", from: 1, to: 3, lines: 3 }],
      terms: ["payment", "gateway"],
    },
  };

  it("a request that names neither gets the same prompt as before", () => {
    assert.equal(lessonPrompt({ ...req, context: groundingPart(null, null, 8) || undefined }, DEFAULT_PROFILE, []), lessonPrompt(req, DEFAULT_PROFILE, []));
    assert.equal(groundOf(null, null), undefined);
  });

  it("the owner's request: taught from the real files, with UML sequence and class diagrams of them required", () => {
    const p = lessonPrompt({ ...req, context: groundingPart(found, diagramsAsked(OWNER), 8) }, DEFAULT_PROFILE, []);
    assert.match(p, /THE STUDENT'S OWN CODEBASE/);
    assert.match(p, /"kola-merchant-portal-v2"/);
    assert.match(p, /=== src\/components\/Merchant-collect\/collection-and-payout\/usePaymentGateway\.ts \(lines 1-3 of 3\) ===\n1\| export function usePaymentGateway\(\)/);
    assert.match(p, /Never invent code, names or behaviour these files do not show/);
    assert.match(p, /not a made-up one/);
    assert.match(p, /THE STUDENT ASKED FOR UML DIAGRAMS \(sequence, class\)/);
    assert.match(p, /At least 4 of the talk boards carry a "diagram"/);
    assert.match(p, /a sequenceDiagram and a classDiagram/);
    assert.match(p, /<\|-- inherits/);
    assert.match(p, /the codebase's real parts and names/);
    // The asks come after the general rules, just before the reply's shape, so they are read last.
    assert.ok(p.indexOf("THE STUDENT'S OWN CODEBASE") > p.indexOf("Rules:") && p.indexOf("THE STUDENT ASKED FOR") < p.indexOf("Reply with only this JSON"));
  });

  it("a codebase not found: the lesson says so on its first board and points to Learn from my own code", () => {
    const missing: CodebaseLookup = { missing: { phrase: "kola myenvironment v2", looked: ["C:\\Users\\me"], near: ["KOLA-MERCHANT-PORTAL-NEXTJS"] } };
    const p = lessonPrompt({ ...req, context: groundingPart(missing, null, 8) }, DEFAULT_PROFILE, []);
    assert.match(p, /THE CODEBASE WAS NOT FOUND/);
    assert.match(p, /The first line of the first board says so plainly/);
    assert.match(p, /"kola myenvironment v2" was not found on this computer/);
    assert.match(p, /"Learn from my own code"/);
    assert.match(p, /never invent file names, classes or functions and call them theirs/);
    assert.match(p, /closest folders were KOLA-MERCHANT-PORTAL-NEXTJS/);
    assert.deepEqual(groundOf(missing, null), { missing: "kola myenvironment v2" });
  });

  it("diagrams asked for without a codebase use the subject's real names, not the analogy's", () => {
    const p = groundingPart(null, diagramsAsked("explain TCP with a sequence diagram"), 8);
    assert.match(p, /THE STUDENT ASKED FOR DIAGRAMS \(sequence\)/);
    assert.match(p, /the real parts and names of the subject, never the analogy's/);
    assert.doesNotMatch(p, /CODEBASE/);
  });

  it("the lesson keeps its grounding, and its scenes use the real names and the asked-for kind", () => {
    const ground = groundOf(found, diagramsAsked(OWNER));
    assert.deepEqual(ground, { codebase: { name: "kola-merchant-portal-v2", path: "C:\\Users\\me\\myenvironment\\kola-merchant-portal-v2" }, diagrams: ["sequence", "class"], uml: true });
    const lesson: Lesson = {
      id: "l1", course: "Kola merchant portal v2", number: 1, title: "Payments in the portal", subject: OWNER, summary: "", createdAt: 0, updatedAt: 0, at: 0, seen: [0], ground,
      boards: [{ title: "The big picture", kind: "talk", analogy: "A post office passes your letter on.", lines: [{ w: "`usePaymentGateway` sends the request", s: "" }] }],
    };
    assert.match(sceneGrounding(lesson), /own codebase, kola-merchant-portal-v2/);
    assert.match(scenePrompt(lesson, 0, DEFAULT_PROFILE), /never made-up code\. The student asked for a sequence diagram/);
    assert.equal(sceneGrounding({ ...lesson, ground: undefined }), "");
  });
});
