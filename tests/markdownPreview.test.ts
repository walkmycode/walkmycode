// The Markdown preview in Explore's Code panel (src/components/markdownBody.tsx): GitHub's Markdown drawn as
// React elements, never as HTML, with links that open files in the project or a tab outside it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { linkTarget, renderMarkdown } from "../src/components/markdownBody";

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

/** Every element in a drawn tree, in order (components are not run: their props are the test's view). */
function elements(node: ReactNode): El[] {
  const out: El[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (isValidElement(n)) {
      out.push(n as El);
      walk((n as El).props.children);
    }
  };
  walk(node);
  return out;
}
const kind = (e: El) => (typeof e.type === "string" ? e.type : (e.type as { name?: string }).name ?? "?");
const textOf = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(textOf).join("") : typeof node === "string" || typeof node === "number" ? String(node) : isValidElement(node) ? textOf((node as El).props.children) : "";

describe("the Markdown preview", () => {
  it("draws headings with GitHub's ids, paragraphs, emphasis and code spans", () => {
    const all = elements(renderMarkdown("# Ownership rules\n\nSome **bold**, *italic*, ~~gone~~ and `code`.\n\n## Ownership rules\n", "README.md"));
    const h = all.filter((e) => /^h\d$/.test(kind(e)));
    assert.deepEqual(h.map((e) => [kind(e), e.props["data-id"], textOf(e.props.children).trim()]), [
      ["h1", "ownership-rules", "Ownership rules"],
      ["h2", "ownership-rules-1", "Ownership rules"],
    ]);
    for (const tag of ["strong", "em", "del", "code"]) assert.ok(all.some((e) => kind(e) === tag), tag);
    assert.equal(textOf(all.find((e) => kind(e) === "code")!.props.children), "code");
  });

  it("draws tables with their alignment, task lists and numbered lists from their start", () => {
    const md = "| Name | Size |\n|:-----|-----:|\n| a | 1 |\n| b | |\n\n- [x] done\n- [ ] todo\n\n3. three\n4. four\n";
    const all = elements(renderMarkdown(md, "README.md"));
    const th = all.filter((e) => kind(e) === "th");
    assert.deepEqual(th.map((e) => (e.props.style as { textAlign?: string } | undefined)?.textAlign), ["left", "right"]);
    assert.equal(all.filter((e) => kind(e) === "td").length, 4, "an empty cell keeps its place");
    const boxes = all.filter((e) => kind(e) === "input");
    assert.deepEqual(boxes.map((e) => e.props.checked), [true, false]);
    assert.equal(all.find((e) => kind(e) === "ol")!.props.start, 3);
  });

  it("colours a fenced block in its language, and shows GitHub's alerts", () => {
    const all = elements(renderMarkdown("```rust\nlet s = 1;\n```\n\n> [!WARNING]\n> Careful.\n", "README.md"));
    const code = all.find((e) => kind(e) === "CodeBlock")!;
    assert.deepEqual([code.props.lang, code.props.code], ["rust", "let s = 1;"]);
    assert.ok(all.some((e) => kind(e) === "div" && String(e.props.className).includes("mdp-alert warning")));
  });

  it("never turns the file's HTML into markup: a script is words at most, an image only from https", () => {
    const all = elements(renderMarkdown('<script>alert(1)</script>\n\n<p align="center"><img src="https://x.test/logo.png" alt="Logo"></p>\n\nHi <b onclick="x()">there</b>\n', "README.md"));
    assert.ok(!all.some((e) => ["script", "b", "p"].includes(kind(e)) && JSON.stringify(e.props).includes("onclick")));
    assert.ok(!all.some((e) => kind(e) === "script"));
    const img = all.find((e) => kind(e) === "Img");
    assert.equal(img?.props.src, "https://x.test/logo.png");
    for (const e of all) for (const k of Object.keys(e.props)) assert.ok(!/^on[A-Z]/.test(k) || typeof e.props[k] === "function", `${kind(e)}.${k}`);
    assert.ok(!all.some((e) => "dangerouslySetInnerHTML" in e.props));
  });

  it("sends links to the right place: out to a tab, a heading here, a file in the project, or nowhere", () => {
    assert.deepEqual(linkTarget("https://doc.rust-lang.org/book/", "rust/01"), { kind: "out", href: "https://doc.rust-lang.org/book/" });
    assert.deepEqual(linkTarget("#the-three-rules", "rust/01"), { kind: "here", id: "the-three-rules" });
    assert.deepEqual(linkTarget("../02_core/README.md#errors", "rust/01_foundations"), { kind: "file", path: "rust/02_core/README.md", id: "errors" });
    assert.deepEqual(linkTarget("examples/slices.rs", "rust/06"), { kind: "file", path: "rust/06/examples/slices.rs" });
    assert.deepEqual(linkTarget("/docs/a%20b.md", "x/y"), { kind: "file", path: "docs/a b.md" });
    assert.equal(linkTarget("javascript:alert(1)", "").kind, "none");
    assert.equal(linkTarget("data:text/html,<b>", "").kind, "none");
    assert.equal(linkTarget("//evil.test/x", "").kind, "none");
  });

  it("finds [text][ref] links from their definitions, and draws bare URLs as links", () => {
    const all = elements(renderMarkdown("See [the book][book] and https://example.com.\n\n[book]: https://doc.rust-lang.org/book/ \"The Book\"\n", "README.md"));
    const links = all.filter((e) => kind(e) === "Anchor");
    assert.deepEqual(links.map((e) => e.props.url), ["https://doc.rust-lang.org/book/", "https://example.com"]);
    assert.equal(links[0].props.title, "The Book");
  });
});
