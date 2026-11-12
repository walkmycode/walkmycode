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
import { followLook } from "@/lib/look";
import { mountLight } from "@/lib/lightDom";
import { bindKeys, type ShellCommands } from "./keys";
import { syncStyles } from "./popoutStyles";
import { lanternTheme } from "./theme";

const dressed = new WeakSet<Document>();

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
  const unfollow = followLook(doc); // text size and density, kept in step while it is open
  win.addEventListener("pagehide", unfollow, { once: true });
  doc.body.style.margin = "0";
  doc.body.style.background = "var(--wall)";
  doc.title = `WalkMyCode — ${title}`;
  const unstyle = syncStyles(document, doc);
  const unbind = bindKeys(doc, commands, opts);
  const unmount = mountLight(win);
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
