// Dressing a pop-out window (docs/SHELL.md §6): dockview copies the page's
// stylesheets into it; this adds what lives outside them — next/font's
// variable classes (they sit on div.root, which the pop-out doesn't have),
// the theme's own class (dockview copies only its dockview-theme-* class onto
// the pop-out's container, so every `.lantern` rule would be lost), dark
// scrollbars, the wall colour, a title, the dock's shortcuts, a light of its
// own (docs/SHELL.md §8: one dot per window), and the stylesheets the main
// window gains after the pop-out opened (popoutStyles.ts).
//
// It runs from api.onDidAddPopoutGroup, once /popout.html has loaded, and not
// from addPopoutGroup's onDidOpen: that fires straight after window.open, on
// the window's first, blank document, which the load of /popout.html then
// replaces, taking every class, key binding and the light with it.
import { appWindowOf } from "@/lib/desktop";
import { followLook } from "@/lib/look";
import { mountLight } from "@/lib/lightDom";
import { bindKeys, type ShellCommands } from "./keys";
import { syncStyles } from "./popoutStyles";
import { lanternTheme } from "./theme";

const dressed = new WeakSet<Document>();

/** In the desktop app a pop-out is a frameless window of the app (src-tauri/src/popout.rs). Once the page
 * that opened it is gone (reloaded, another room) or its panels have all left, nothing would ever close
 * it: an empty box with no buttons. A script of its own, running in the pop-out (this page's code stops
 * with this page), checks every second and closes its window through its own bridge to the app. */
function watchOpener(doc: Document) {
  const script = doc.createElement("script");
  script.textContent = `(() => {
    const bridge = window.__TAURI_INTERNALS__;
    const label = bridge && bridge.metadata && bridge.metadata.currentWindow && bridge.metadata.currentWindow.label;
    if (!label) return;
    let opener = null;
    try { opener = window.opener && window.opener.document; } catch (e) {}
    const timer = setInterval(() => {
      let gone = false;
      try { gone = !window.opener || window.opener.closed || window.opener.document !== opener || !document.querySelector(".dv-groupview .dv-tab"); } catch (e) { gone = true; }
      if (!gone) return;
      clearInterval(timer);
      bridge.invoke("plugin:window|close", { label }).catch(() => {});
    }, 1000);
  })();`;
  doc.head.append(script);
}

export function preparePopout(win: Window, title: string, commands: ShellCommands, opts: { popout: boolean }) {
  const doc = win.document;
  if (dressed.has(doc)) return;
  dressed.add(doc);
  const root = document.querySelector(".root");
  // Only the font classes: the .root class itself sets height:100vh, flex and the font.
  const fontClasses = [...(root?.classList ?? [])].filter((c) => c !== "root");
  if (fontClasses.length) doc.body.classList.add(...fontClasses);
  doc.body.classList.add("popout-body");
  doc.getElementById("dv-popout-window")?.classList.add(...lanternTheme.className.split(/\s+/).filter(Boolean));
  doc.documentElement.style.colorScheme = "dark";
  doc.documentElement.lang = "en-GB";
  const motion = document.documentElement.dataset.motion;
  if (motion) doc.documentElement.dataset.motion = motion;
  // The desktop app: the pop-out has no frame, and its tab bar is the title bar (GroupActions.tsx).
  if (document.documentElement.dataset.desktop !== undefined) doc.documentElement.dataset.desktop = "";
  const unfollow = followLook(doc); // text size and density, kept in step while it is open
  win.addEventListener("pagehide", unfollow, { once: true });
  doc.body.style.margin = "0";
  doc.body.style.background = "var(--wall)";
  doc.title = `WalkMyCode — ${title}`;
  const unstyle = syncStyles(document, doc);
  const unbind = bindKeys(doc, commands, opts);
  const unmount = mountLight(win);
  if (document.documentElement.dataset.desktop !== undefined) {
    // window.close() on a pop-out (dockview calls it when the last panel leaves, docking calls it) only
    // empties a window of the app, leaving its frameless box: it asks the app to close the window instead.
    const app = appWindowOf(win);
    if (app) Object.defineProperty(win, "close", { configurable: true, value: () => void app.close().catch(() => {}) });
    watchOpener(doc);
  }
  win.addEventListener(
    "pagehide",
    () => {
      unstyle();
      unbind();
      unmount();
    },
    { once: true },
  );
}
