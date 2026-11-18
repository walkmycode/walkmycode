// "Format this file" (src/ide/format.ts, src/ide/formatRun.ts): which of Prettier's parsers reads a
// file, the project's own settings, plain words for what can't be formatted or read, and the one edit
// it makes. Prettier itself runs here too, as the page runs it (prettier/standalone and its plugins).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanPrettierOptions, formatError, formatPlanFor, formatUnavailable, prettierConfigFor, smallestChange } from "../src/ide/format";
import { formatText } from "../src/ide/formatRun";

describe("which parser formats a file", () => {
  it("picks Prettier's parser and only the plugins it needs, by the file's name", () => {
    assert.deepEqual(formatPlanFor("lib/tasks.ts"), { parser: "typescript", plugins: ["typescript", "estree"] });
    assert.deepEqual(formatPlanFor("components/TaskCard.tsx"), { parser: "typescript", plugins: ["typescript", "estree"] });
    assert.deepEqual(formatPlanFor("a/b.mjs"), { parser: "babel", plugins: ["babel", "estree"] });
    assert.equal(formatPlanFor("x.jsx")?.parser, "babel");
    assert.equal(formatPlanFor("tsconfig.json")?.parser, "json");
    assert.equal(formatPlanFor("web/package.json")?.parser, "json-stringify", "package.json keeps npm's layout");
    assert.deepEqual(formatPlanFor("app.scss"), { parser: "scss", plugins: ["postcss"] });
    assert.equal(formatPlanFor("a.less")?.parser, "less");
    assert.equal(formatPlanFor("a.css")?.parser, "css");
    assert.deepEqual(formatPlanFor("index.HTML"), { parser: "html", plugins: ["html", "babel", "estree", "postcss"] });
    assert.deepEqual(formatPlanFor("README.md"), { parser: "markdown", plugins: ["markdown"] });
    assert.equal(formatPlanFor(".github/ci.yml")?.parser, "yaml");
    assert.equal(formatPlanFor("schema.graphql")?.parser, "graphql");
  });

  it("says plainly which files it can't format yet", () => {
    assert.equal(formatPlanFor("src/main.rs"), null);
    assert.equal(formatUnavailable("src/main.rs"), "Formatting Rust files isn’t available yet");
    assert.equal(formatUnavailable("app/main.py"), "Formatting Python files isn’t available yet");
    assert.equal(formatUnavailable("Program.cs"), "Formatting C# files isn’t available yet");
    assert.equal(formatUnavailable("notes.xyz"), "Formatting .xyz files isn’t available yet");
    assert.equal(formatUnavailable("Dockerfile"), "Formatting this file isn’t available yet");
    assert.equal(formatUnavailable("a.ts"), null);
    assert.equal(formatUnavailable(null), "Formatting this file isn’t available yet");
  });
});

describe("the project's own Prettier settings", () => {
  const files = {
    "package.json": JSON.stringify({ name: "root", prettier: { semi: false, printWidth: 100, plugins: ["x"], overrides: [], endOfLine: "crlf", tabWidth: "4" } }),
    "web/.prettierrc": '{ "singleQuote": true, "trailingComma": "none" }',
    "web/src/app.ts": "",
    "api/.prettierrc": "semi: false\n",
    "api/package.json": JSON.stringify({ name: "api" }),
    "api/x.ts": "",
    "docs/.prettierrc.json": '{"proseWrap":"always","useTabs":"yes"}',
    "lib/package.json": JSON.stringify({ prettier: "@company/prettier-config" }),
  };

  it("takes the nearest folder's config, as Prettier looks, keeping only layout settings that are right", () => {
    assert.deepEqual(prettierConfigFor("web/src/app.ts", files), { options: { singleQuote: true, trailingComma: "none" }, from: "web/.prettierrc" });
    assert.deepEqual(prettierConfigFor("src/x.ts", files), { options: { semi: false, printWidth: 100 }, from: "package.json" }, "plugins, overrides, the line ending and a wrong type left out");
    assert.deepEqual(prettierConfigFor("docs/guide.md", files), { options: { proseWrap: "always" }, from: "docs/.prettierrc.json" });
  });

  it("reads only JSON: a YAML config, or a shared one by name, means Prettier's defaults", () => {
    assert.deepEqual(prettierConfigFor("api/x.ts", files), { options: {}, from: "api/.prettierrc" }, "a package.json without one is passed over");
    assert.deepEqual(prettierConfigFor("lib/a.ts", files), { options: {}, from: "lib/package.json" });
    assert.deepEqual(prettierConfigFor("a.ts", {}), { options: {}, from: null });
    assert.deepEqual(prettierConfigFor("a.ts", { "package.json": "{ not json" }), { options: {}, from: null });
  });

  it("checks each setting's value", () => {
    assert.deepEqual(cleanPrettierOptions({ printWidth: 0, tabWidth: 2, arrowParens: "sometimes", quoteProps: "consistent" }), { tabWidth: 2, quoteProps: "consistent" });
    assert.deepEqual(cleanPrettierOptions([1, 2]), {});
    assert.deepEqual(cleanPrettierOptions(null), {});
  });
});

describe("formatting", () => {
  const messy = 'const  a = {b:1,\n  c:[1,2,3]}\nfunction  f( x:number ){return x*2}\n';

  it("lays out TypeScript with Prettier, with the project's settings, and keeps the cursor near its code", async () => {
    const r = await formatText("lib/tasks.ts", messy, messy.indexOf("function"), {});
    assert.equal(r!.text, "const a = { b: 1, c: [1, 2, 3] };\nfunction f(x: number) {\n  return x * 2;\n}\n");
    assert.equal(r!.text.slice(r!.cursor, r!.cursor + 8), "function");
    const own = await formatText("lib/tasks.ts", messy, 0, { semi: false, tabWidth: 4 });
    assert.match(own!.text, /\n {4}return x \* 2\n/);
  });

  it("formats JSON, CSS, Markdown and YAML too", async () => {
    assert.equal((await formatText("a.json", '{"a":1,"b":[1,2]}', 0, {}))!.text, '{ "a": 1, "b": [1, 2] }\n');
    assert.equal((await formatText("a.css", "a{color:red}", 0, {}))!.text, "a {\n  color: red;\n}\n");
    assert.equal((await formatText("a.md", "#  Title\n*  one", 0, {}))!.text, "# Title\n\n- one\n");
    assert.equal((await formatText("a.yml", "a:   1\nb:\n    - x", 0, {}))!.text, "a: 1\nb:\n  - x\n");
    assert.equal(await formatText("a.rs", "fn main(){}", 0, {}), null);
  });

  it("says where the code has a mistake, in plain words, and changes nothing", async () => {
    const bad = "function f( {\n  return 1\n}\n";
    await assert.rejects(formatText("a.ts", bad, 0, {}), (e) => {
      const said = formatError(e);
      assert.match(said, /^Couldn’t format: the code has a mistake at line \d+, column \d+\. /);
      assert.match(said, /Nothing was changed\.$/);
      assert.ok(!said.includes("|"), "no code frame");
      return true;
    });
    assert.equal(formatError(new Error("boom")), "Couldn’t format: the code has a mistake. boom Nothing was changed.");
  });

  it("makes one edit, only where the text differs, so the lines around it stay put", () => {
    assert.deepEqual(smallestChange("abcXdef", "abcYYdef"), { from: 3, to: 4, insert: "YY" });
    assert.deepEqual(smallestChange("same", "same"), { from: 4, to: 4, insert: "" });
    assert.deepEqual(smallestChange("aa", "aaa"), { from: 2, to: 2, insert: "a" });
    assert.deepEqual(smallestChange("", "x"), { from: 0, to: 0, insert: "x" });
    const a = "x\ny\n", b = "x\nyy\n";
    const c = smallestChange(a, b);
    assert.equal(a.slice(0, c.from) + c.insert + a.slice(c.to), b);
  });
});
