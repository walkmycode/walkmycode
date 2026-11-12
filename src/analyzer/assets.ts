// Where the page's own static files are served (public/wasm, the tree-sitter
// runtime and grammars). In the app that is the site's root, as always. WalkMyCode
// Lite is served by Claude at a path that is not the root, so there they sit next
// to the page. A Web Worker has no page to look at: whoever starts it passes the
// page's base along (setAssetBase), as buildInWorker does.
let base: string | null = null;

/** The page's base, handed to a worker; nothing (or "") goes back to working it out. */
export function setAssetBase(b: string | null | undefined): void {
  base = b || null;
}

/** "/" in the app; the page's folder (absolute) in WalkMyCode Lite. */
export function assetBase(): string {
  if (base) return base;
  if (process.env.NEXT_PUBLIC_WALKMYCODE_TARGET === "lite" && typeof document !== "undefined") return new URL("./", document.baseURI).href;
  return "/";
}

/** "wasm/x.wasm" → "/wasm/x.wasm" in the app, "<the page's folder>/wasm/x.wasm" in Lite. */
export const assetUrl = (path: string): string => assetBase() + path.replace(/^\/+/, "");

/** A Web Worker's URL as the bundler (Turbopack) builds it: resolved from the site's root,
 * with the chunks the worker must load, and their base, in "#params=". Re-based on the
 * page's folder, which is where WalkMyCode Lite's chunks are. Anything else comes back as it was. */
export function rebaseWorkerUrl(url: string, page: string): string {
  try {
    const u = new URL(url);
    const out = new URL(`.${u.pathname}`, page);
    out.search = u.search;
    out.hash = u.hash;
    if (u.hash.startsWith("#params=")) {
      const params: unknown = JSON.parse(decodeURIComponent(u.hash.slice("#params=".length)));
      const onPage = (p: unknown) => (typeof p === "string" && p ? new URL(p.startsWith("/") ? `.${p}` : p, page).href : p);
      if (Array.isArray(params) && Array.isArray(params[0])) {
        params[0] = params[0].map(onPage);
        params[2] = onPage(params[2]);
      }
      out.hash = `#params=${encodeURIComponent(JSON.stringify(params))}`;
    }
    return out.href;
  } catch {
    return url;
  }
}

/** Start a Web Worker the bundler builds (`new Worker(new URL(…, import.meta.url))` inside
 * `make`) so that in WalkMyCode Lite it loads next to the page; in the app it starts as it always
 * has. The bundler calls the global Worker with its own URL, so for that one call the global
 * is a subclass that re-bases the URL first. */
export function startWorker(make: () => Worker): Worker {
  const page = assetBase();
  const Base = globalThis.Worker;
  if (page === "/" || typeof Base !== "function") return make();
  class PageWorker extends Base {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(rebaseWorkerUrl(String(url), page), options);
    }
  }
  globalThis.Worker = PageWorker;
  try {
    return make();
  } finally {
    globalThis.Worker = Base;
  }
}
