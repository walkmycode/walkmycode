// A pop-out window keeps the main window's look (src/shell/popoutStyles.ts,
// docs/SHELL.md §6): every URL in a copied sheet is made absolute against the
// main window, and the sheets the main window's <head> gains, swaps or rewrites
// after the pop-out opened reach the pop-out too. Run on a small fake DOM.
// Also: the pop-out is dressed only once its own page has loaded (popout.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { absoluteUrl, absolutiseCss, cloneStyle, syncStyles, type ObserverCtor, type StyleDoc, type StyleNode } from "../src/shell/popoutStyles";

class El implements StyleNode {
  readonly nodeType = 1;
  parentNode: El | null = null;
  children: El[] = [];
  attrs = new Map<string, string>();
  textContent: string | null = "";
  constructor(readonly tagName: string) {}
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  appendChild(c: El) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
}

function fakeDoc(baseURI: string) {
  const head = new El("HEAD");
  const doc = {
    baseURI,
    head,
    createElement: (t: string) => new El(t.toUpperCase()),
    querySelectorAll: (q: string) => {
      assert.match(q, /^link\[rel~="stylesheet"/);
      return head.children.filter((c) => c.tagName === "LINK" && /stylesheet/i.test(c.getAttribute("rel") ?? ""));
    },
  };
  return doc satisfies StyleDoc;
}
const link = (href: string) => {
  const l = new El("LINK");
  l.setAttribute("rel", "stylesheet");
  l.setAttribute("href", href);
  return l;
};
const style = (css: string) => {
  const s = new El("STYLE");
  s.textContent = css;
  return s;
};

type Rec = Parameters<ConstructorParameters<ObserverCtor>[0]>[0][number];
/** A MutationObserver the test fires by hand. */
function fakeObserver() {
  const state: { cb: ((r: Rec[]) => void) | null; observed: StyleNode | null; disconnected: boolean } = { cb: null, observed: null, disconnected: false };
  const Ctor = class {
    constructor(cb: (r: Rec[]) => void) {
      state.cb = cb;
    }
    observe(t: StyleNode) {
      state.observed = t;
    }
    disconnect() {
      state.disconnected = true;
    }
  } as unknown as ObserverCtor;
  return { Ctor, state, fire: (r: Rec[]) => state.cb?.(r) };
}

const MAIN = "http://localhost:3116/map?repo=team-tasks";
const hrefs = (d: { head: El }) => d.head.children.map((c) => (c.tagName === "LINK" ? c.getAttribute("href") : `style:${c.textContent}`));

describe("pop-out href rewriting", () => {
  it("makes relative and root-relative URLs absolute against the main window", () => {
    assert.equal(absoluteUrl("/_next/static/chunks/a.css", MAIN), "http://localhost:3116/_next/static/chunks/a.css");
    assert.equal(absoluteUrl("media/x.woff2", "http://localhost:3116/learn/one"), "http://localhost:3116/learn/media/x.woff2");
    assert.equal(absoluteUrl("https://cdn.example/a.css", MAIN), "https://cdn.example/a.css");
  });

  it("rewrites url(…) and @import in CSS text, leaving data:, absolute and fragment URLs alone", () => {
    const css = `@font-face{font-family:Inter;src:url(/_next/static/media/inter.woff2) format("woff2")}
      .a{background:url('img/a.png')} .b{background:url("data:image/png;base64,AAA")} .c{mask:url(#m)}
      .d{background:url(https://x.test/y.png)} @import "theme.css";`;
    const out = absolutiseCss(css, "http://localhost:3116/learn/one");
    assert.match(out, /url\(http:\/\/localhost:3116\/_next\/static\/media\/inter\.woff2\)/);
    assert.match(out, /url\('http:\/\/localhost:3116\/learn\/img\/a\.png'\)/);
    assert.match(out, /url\("data:image\/png;base64,AAA"\)/);
    assert.match(out, /url\(#m\)/);
    assert.match(out, /url\(https:\/\/x\.test\/y\.png\)/);
    assert.match(out, /@import "http:\/\/localhost:3116\/learn\/theme\.css"/);
  });

  it("clones a <link> with an absolute href and a <style> with absolute urls, and nothing else", () => {
    const to = fakeDoc("http://localhost:3116/popout.html");
    const l = link("/_next/static/chunks/ide.css");
    l.setAttribute("media", "screen");
    const c = cloneStyle(l, to, MAIN) as El;
    assert.equal(c.tagName, "LINK");
    assert.equal(c.getAttribute("href"), "http://localhost:3116/_next/static/chunks/ide.css");
    assert.equal(c.getAttribute("rel"), "stylesheet");
    assert.equal(c.getAttribute("media"), "screen");
    const s = cloneStyle(style(".x{src:url(/f.woff2)}"), to, MAIN) as El;
    assert.equal(s.textContent, ".x{src:url(http://localhost:3116/f.woff2)}");
    assert.equal(cloneStyle(new El("SCRIPT"), to, MAIN), null);
    const icon = new El("LINK");
    icon.setAttribute("rel", "icon");
    assert.equal(cloneStyle(icon, to, MAIN), null);
  });
});

describe("pop-out stylesheet sync", () => {
  function setup() {
    const from = fakeDoc(MAIN);
    const to = fakeDoc("http://localhost:3116/popout.html");
    // What the main window had when the pop-out loaded, and what dockview copied of it.
    const app = from.head.appendChild(link("/_next/static/chunks/app.css"));
    const loading = from.head.appendChild(link("/_next/static/chunks/still-loading.css")); // no sheet yet: dockview missed it
    to.head.appendChild(link("http://localhost:3116/_next/static/chunks/app.css"));
    const obs = fakeObserver();
    const stop = syncStyles(from, to, obs.Ctor);
    return { from, to, app, loading, obs, stop };
  }

  it("catches up a linked sheet dockview missed, without doubling the ones it copied", () => {
    const { to, obs } = setup();
    assert.deepEqual(hrefs(to), ["http://localhost:3116/_next/static/chunks/app.css", "http://localhost:3116/_next/static/chunks/still-loading.css"]);
    assert.ok(obs.state.observed, "watches the main window's head");
  });

  it("copies sheets added later (a lazy chunk, a dev-server <style>) and drops ones removed", () => {
    const { from, to, app, obs } = setup();
    const lazy = from.head.appendChild(link("/_next/static/chunks/ide.css"));
    const hmr = from.head.appendChild(style(".a{src:url(/m.woff2)}"));
    obs.fire([{ type: "childList", target: from.head, addedNodes: [lazy, hmr], removedNodes: [] }]);
    assert.deepEqual(hrefs(to).slice(2), ["http://localhost:3116/_next/static/chunks/ide.css", "style:.a{src:url(http://localhost:3116/m.woff2)}"]);
    // A hot update swaps app.css for a new file: the old copy (dockview's) goes too.
    app.remove();
    const app2 = from.head.appendChild(link("/_next/static/chunks/app.v2.css"));
    obs.fire([{ type: "childList", target: from.head, addedNodes: [app2], removedNodes: [app] }]);
    const now = hrefs(to);
    assert.ok(!now.includes("http://localhost:3116/_next/static/chunks/app.css"));
    assert.ok(now.includes("http://localhost:3116/_next/static/chunks/app.v2.css"));
  });

  it("follows a <style> rewritten in place, and ignores what is not a stylesheet", () => {
    const { from, to, obs } = setup();
    const s = from.head.appendChild(style(".a{color:red}"));
    obs.fire([{ type: "childList", target: from.head, addedNodes: [s], removedNodes: [] }]);
    s.textContent = ".a{color:blue}";
    const text = { nodeType: 3, parentNode: s, textContent: s.textContent } as StyleNode;
    obs.fire([{ type: "characterData", target: text, addedNodes: [], removedNodes: [] }]);
    assert.equal(hrefs(to).at(-1), "style:.a{color:blue}");
    const before = to.head.children.length;
    const script = from.head.appendChild(new El("SCRIPT"));
    obs.fire([{ type: "childList", target: from.head, addedNodes: [script], removedNodes: [] }]);
    assert.equal(to.head.children.length, before);
  });

  it("stops watching when the pop-out closes", () => {
    const { stop, obs } = setup();
    stop();
    assert.equal(obs.state.disconnected, true);
  });
});

describe("pop-out dressing", () => {
  const src = (f: string) => readFileSync(join(process.cwd(), "src/shell", f), "utf8");
  it("dresses the window from onDidAddPopoutGroup (its loaded page), never from onDidOpen (the blank one it replaces)", () => {
    assert.doesNotMatch(src("actions.ts"), /onDidOpen\s*:/);
    assert.match(src("Workspace.tsx"), /onDidAddPopoutGroup\([^]*?preparePopout\(/);
  });
  it("puts the theme's own class on the pop-out's container and keeps its styles in sync", () => {
    const p = src("popout.ts");
    assert.match(p, /getElementById\("dv-popout-window"\)\?\.classList\.add\(\.\.\.lanternTheme\.className/);
    assert.match(p, /syncStyles\(document, doc\)/);
  });
});
