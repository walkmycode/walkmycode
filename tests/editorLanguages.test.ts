// The languages the editor colours (src/ide/languages.ts): which one a file gets, that each has a
// parser that reads its code, fenced blocks in Markdown, and that suggestions while typing
// (src/ide/suggest.ts) know every one of them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { languageExtension, languageOf, type Language } from "../src/ide/languages";
import { SUGGEST, sourcesOf, suggestions } from "../src/ide/suggest";

/** The names of the nodes a language's parser makes of some code. With `at`, the nodes around that
 * piece of the text instead: code inside other code (HTML in PHP, a fenced block) is only seen there. */
function nodesOf(lang: Language, doc: string, at?: string): Set<string> {
  const state = EditorState.create({ doc, extensions: [languageExtension(lang)] });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  assert.ok(tree, `${lang} parsed`);
  const names = new Set<string>();
  if (at === undefined) tree.iterate({ enter: (n) => void names.add(n.name) });
  else for (let n: { name: string; parent: unknown } | null = tree.resolveInner(doc.indexOf(at) + 1, 1); n; n = n.parent as typeof n) names.add(n.name);
  return names;
}

async function offered(lang: Language, doc: string): Promise<string[]> {
  const state = EditorState.create({ doc, extensions: [languageExtension(lang), suggestions(lang, true)] });
  const out: string[] = [];
  const plan = SUGGEST[lang]!;
  for (const source of plan.own ? state.languageDataAt<CompletionSource>("autocomplete", doc.length) : sourcesOf(plan)) {
    const r = await source(new CompletionContext(state, doc.length, false));
    if (!r) continue;
    const typed = state.sliceDoc(r.from, doc.length).toLowerCase();
    for (const o of r.options) if (o.label.toLowerCase().startsWith(typed)) out.push(o.label);
  }
  return out.sort();
}

describe("the editor's languages", () => {
  it("picks a language from the file's extension", () => {
    const want: Record<string, Language> = {
      "src/main.c": "c",
      "include/util.h": "c",
      "src/app.cpp": "cpp",
      "src/app.cc": "cpp",
      "src/app.cxx": "cpp",
      "include/app.hpp": "cpp",
      "include/app.hh": "cpp",
      "include/app.hxx": "cpp",
      "Api/Program.cs": "csharp",
      "src/main/java/app/Main.java": "java",
      "lib/main.dart": "dart",
      "src/main/kotlin/app/Main.kt": "kotlin",
      "build.gradle.kts": "kotlin",
      "app/Models/Todo.php": "php",
      "resources/views/todos/index.blade.php": "php",
      "src/main.rs": "rust",
      "app.py": "python",
      "page.tsx": "tsx",
      "notes.md": "markdown",
      "Dockerfile": "text",
      "archive.c.txt": "text",
    };
    for (const [path, lang] of Object.entries(want)) assert.equal(languageOf(path), lang, path);
    assert.equal(languageOf(null), "text");
  });

  it("reads C, C++, Java and PHP with CodeMirror's own parsers", () => {
    assert.ok(nodesOf("c", '#include "util.h"\nint add(int a, int b) { return a + b; } // sum\n').has("FunctionDefinition"));
    const cpp = nodesOf("cpp", "namespace shop { class Cart { public: void add(int id); }; }\n");
    assert.ok(cpp.has("ClassSpecifier") && cpp.has("NamespaceDefinition"));
    const java = nodesOf("java", 'package app;\npublic class Main { public static void main(String[] args) { System.out.println("hi"); } }\n');
    assert.ok(java.has("ClassDeclaration") && java.has("MethodDeclaration") && java.has("StringLiteral"));
    const page = "<h1>Todos</h1>\n<?php\nfunction total(array $items): int { return count($items); }\n";
    assert.ok(nodesOf("php", page).has("FunctionDefinition"), "PHP after <?php");
    assert.ok(nodesOf("php", page, "h1").has("Element"), "HTML before it");
  });

  it("reads C#, Dart and Kotlin with CodeMirror's stream modes", () => {
    const kt = nodesOf("kotlin", 'package app\nclass Note(val title: String) { fun shout() = "hi" } // note\n');
    assert.ok(kt.has("keyword") && kt.has("string") && kt.has("comment"), [...kt].join(","));
    const cs = nodesOf("csharp", 'namespace Api;\npublic class Todo { public string Title { get; set; } = "x"; } // done\n');
    assert.ok(cs.has("keyword") && cs.has("string") && cs.has("comment"), [...cs].join(","));
    const dart = nodesOf("dart", "import 'package:flutter/material.dart';\nclass App extends StatelessWidget { final int count = 3; } // app\n");
    assert.ok(dart.has("keyword") && dart.has("string") && dart.has("comment"), [...dart].join(","));
  });

  it("colours a fenced block in Markdown in its own language", () => {
    const md = (lang: string, code: string) => nodesOf("markdown", `# Notes\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`, code.split(" ")[1]);
    assert.ok(md("java", "class Abc { void f() {} }").has("ClassDeclaration"));
    assert.ok(md("cpp", "class Abc { };").has("ClassSpecifier"));
    assert.ok(md("c", "int fgh(void) { return 1; }").has("FunctionDefinition"));
    assert.ok(md("php", "function fgh() { return 1; }").has("FunctionDefinition"), "no <?php needed in a fenced block");
    assert.ok(md("csharp", "public class Abc { }").has("keyword"));
    assert.ok(md("dart", "final class Abc { }").has("keyword"));
    assert.ok(md("kotlin", "data class Abc(val x: Int)").has("keyword"));
    assert.ok(md("rust", "fn main() {}").has("FunctionItem"));
  });

  it("suggests each new language's keywords and the names already in the file", async () => {
    for (const l of ["c", "cpp", "java", "csharp", "kotlin", "dart", "php"] as const) {
      assert.equal(SUGGEST[l]?.words, "code", l);
      assert.ok(SUGGEST[l]?.keywords?.length, l);
      assert.equal(!!SUGGEST[l]?.own, l === "php", `${l}: only PHP's package has sources to keep (HTML's tags)`);
    }
    assert.deepEqual(await offered("c", "int running_total = 0;\nint main(void) {\n  run"), ["running_total"]);
    assert.deepEqual(await offered("c", "int main(void) {\n  whi"), ["while"]);
    assert.deepEqual(await offered("cpp", "class Cart {};\nnam"), ["namespace"]);
    assert.deepEqual(await offered("java", "class Main {\n  int studentCount = 3;\n  void f() { stu"), ["studentCount"]);
    assert.deepEqual(await offered("java", "class Main {\n  syn"), ["synchronized"]);
    assert.deepEqual(await offered("csharp", "class Todo {\n  int itemCount = 3;\n  void F() { ite"), ["itemCount"]);
    assert.deepEqual(await offered("csharp", "names"), ["namespace"]);
    assert.deepEqual(await offered("kotlin", "val noteCount = 3\nfun main() { println(note"), ["noteCount"]);
    assert.deepEqual(await offered("kotlin", "class A {\n  comp"), ["companion"]);
    assert.deepEqual(await offered("dart", "final cartTotal = 3;\nvoid main() { car"), ["cartTotal"]);
    assert.deepEqual(await offered("dart", "ext"), ["extends", "extension", "external"]);
    assert.deepEqual(await offered("php", "<?php\n$orderTotal = 3;\necho $orderT"), ["$orderTotal"]);
    assert.deepEqual(await offered("php", "<?php\nforea"), ["foreach"]);
  });

  it("stays out of comments and strings in the new languages too", async () => {
    assert.deepEqual(await offered("java", "class Main {\n  int studentCount = 3;\n  // the stu"), []);
    assert.deepEqual(await offered("csharp", 'class Todo {\n  int taskCount = 3;\n  string s = "tas'), []);
    assert.deepEqual(await offered("dart", "final cartTotal = 3;\n// car"), []);
    assert.deepEqual(await offered("kotlin", 'val noteCount = 3\nval s = "note'), []);
    assert.deepEqual(await offered("cpp", 'int running_total = 0;\nconst char* s = "run'), []);
  });
});
