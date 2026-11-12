// Keeping a pop-out window's styles in step with the main window's (docs/SHELL.md §6).
// dockview copies the page's stylesheets into the pop-out once, when its window
// loads: a <link> whose sheet was still loading then (it is not in
// document.styleSheets yet), a lazy chunk's CSS added later, or a dev-server
// hot update never reaches it. This mirrors every <link rel=stylesheet> and
// <style> the main window's <head> gains, swaps or loses from then on, with
// each URL made absolute against the main window, so a relative href or an
// @font-face url() in a copied <style> still finds its file from /popout.html.
// Only the few DOM members it needs are typed, so the tests pass a fake.

export interface StyleNode {
  readonly nodeType: number;
  readonly tagName?: string;
  readonly parentNode: StyleNode | null;
  textContent: string | null;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  remove?(): void;
}
export interface StyleDoc {
  readonly baseURI: string;
  readonly head: StyleNode & { appendChild(n: StyleNode): unknown };
  createElement(tag: string): StyleNode;
  querySelectorAll(selector: string): ArrayLike<StyleNode>;
}
interface MutationLike {
  type: string;
  target: StyleNode;
  addedNodes: ArrayLike<StyleNode>;
  removedNodes: ArrayLike<StyleNode>;
}
export type ObserverCtor = new (cb: (records: MutationLike[]) => void) => {
  observe(target: StyleNode, init: { childList?: boolean; subtree?: boolean; characterData?: boolean }): void;
  disconnect(): void;
};

const LINK_SHEETS = 'link[rel~="stylesheet" i]';

/** `href` resolved against `base`; left alone if it cannot be parsed. */
export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** Already absolute, or not a file at all: a scheme (https:, data:, blob:) or a fragment. */
const keep = (u: string) => /^(?:[a-z][a-z\d+.-]*:|#)/i.test(u);

/** Every url(…) and bare @import "…" in `css`, made absolute against `base`. */
export function absolutiseCss(css: string, base: string): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi, (m, q: string, u: string) => (!u || keep(u) ? m : `url(${q}${absoluteUrl(u, base)}${q})`))
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q: string, u: string) => (keep(u) ? m : `@import ${q}${absoluteUrl(u, base)}${q}`));
}

const tag = (n: StyleNode) => (n.nodeType === 1 ? (n.tagName ?? "").toUpperCase() : "");
const isLink = (n: StyleNode) => tag(n) === "LINK" && /(^|\s)stylesheet(\s|$)/i.test(n.getAttribute?.("rel") ?? "");
const isStyle = (n: StyleNode) => tag(n) === "STYLE";

/** A copy of a <link rel=stylesheet> or <style> made in `to`, its URLs absolute against `base`. */
export function cloneStyle(node: StyleNode, to: StyleDoc, base: string): StyleNode | null {
  if (!isLink(node) && !isStyle(node)) return null;
  const el = to.createElement(isLink(node) ? "link" : "style");
  for (const a of ["media", "nonce", "crossorigin", "data-n-href"]) {
    const v = node.getAttribute?.(a);
    if (v != null) el.setAttribute?.(a, v);
  }
  if (isLink(node)) {
    el.setAttribute?.("rel", "stylesheet");
    el.setAttribute?.("href", absoluteUrl(node.getAttribute?.("href") ?? "", base));
  } else el.textContent = absolutiseCss(node.textContent ?? "", base);
  return el;
}

/** Mirror `from`'s head styles into `to` from now on; returns the stop. */
export function syncStyles(from: StyleDoc, to: StyleDoc, Observer: ObserverCtor = MutationObserver as unknown as ObserverCtor): () => void {
  const base = from.baseURI;
  const copies = new Map<StyleNode, StyleNode>();
  const add = (n: StyleNode) => {
    if (copies.has(n)) return;
    const c = cloneStyle(n, to, base);
    if (!c) return;
    to.head.appendChild(c);
    copies.set(n, c);
  };

  // What dockview already copied, by address, so a swapped-out sheet goes from
  // the pop-out too; and any linked sheet it missed because it was still loading.
  const there = new Map<string, StyleNode>();
  for (const l of Array.from(to.querySelectorAll(LINK_SHEETS))) there.set(absoluteUrl(l.getAttribute?.("href") ?? "", to.baseURI), l);
  for (const l of Array.from(from.querySelectorAll(LINK_SHEETS))) {
    const copy = there.get(absoluteUrl(l.getAttribute?.("href") ?? "", base));
    if (copy) copies.set(l, copy);
    else add(l);
  }

  /** The <style> a text change happened in, if it is one we copied. */
  const styleOf = (n: StyleNode | null): StyleNode | null => {
    for (let p = n; p; p = p.parentNode) if (isStyle(p)) return p;
    return null;
  };
  const obs = new Observer((records) => {
    for (const r of records) {
      if (r.type === "childList" && r.target === from.head) {
        for (const n of Array.from(r.removedNodes)) {
          copies.get(n)?.remove?.();
          copies.delete(n);
        }
        for (const n of Array.from(r.addedNodes)) add(n);
        continue;
      }
      // A <style> rewritten in place (a hot update): its copy follows.
      const s = styleOf(r.target);
      const c = s && copies.get(s);
      if (s && c) c.textContent = absolutiseCss(s.textContent ?? "", base);
      else if (s && s.parentNode === from.head) add(s);
    }
  });
  obs.observe(from.head, { childList: true, subtree: true, characterData: true });
  return () => obs.disconnect();
}
