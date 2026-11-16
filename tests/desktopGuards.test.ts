// The desktop app turns off the browser's own right-click menu and its reload and back keys (src/lib/desktopBoot.ts),
// found in the app on 16 Nov: right-clicking showed WebView2's Back, Refresh, Save as, Print, More tools. These tests
// run the very script text the page runs in <head>.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { DESKTOP_BOOT } from "../src/lib/desktopBoot";

type Listener = (e: Record<string, unknown>) => void;

/** A page as DESKTOP_BOOT sees it: in the desktop app (with Tauri) or in a browser. */
function page({ desktop = true, selection = "" } = {}) {
  const on: Record<string, Listener[]> = {};
  const add = (type: string, fn: Listener) => void (on[type] ??= []).push(fn);
  const document = { addEventListener: add, documentElement: { dataset: {} as Record<string, string> } };
  const window: Record<string, unknown> = { addEventListener: add, getSelection: () => selection };
  if (desktop) window.__TAURI_INTERNALS__ = {};
  vm.runInNewContext(DESKTOP_BOOT, { window, document });
  const fire = (type: string, props: Record<string, unknown>) => {
    let prevented = false;
    const e = { ctrlKey: false, metaKey: false, altKey: false, ...props, preventDefault: () => void (prevented = true) };
    for (const fn of on[type] ?? []) fn(e);
    return prevented;
  };
  return { document, on, fire };
}
const el = (inside: string | null) => ({ closest: (sel: string) => (inside && sel.split(",").some((s) => s.trim() === inside) ? {} : null) });

describe("the desktop app's guards against the browser's own controls", () => {
  it("shows no browser menu on a right-click, except in a text field, the code editor or on selected text", () => {
    const p = page();
    assert.equal(p.fire("contextmenu", { target: el(null) }), true, "on the map or a board: no Back / Refresh / Print menu");
    assert.equal(p.fire("contextmenu", { target: el("textarea") }), false, "in the ask box: Cut, Copy, Paste");
    assert.equal(p.fire("contextmenu", { target: el(".cm-editor") }), false, "in the code editor");
    assert.equal(page({ selection: "selected words" }).fire("contextmenu", { target: el(null) }), false, "on selected text: Copy");
  });

  it("stops the browser reloading or going back from the keyboard or the mouse, and nothing else", () => {
    const p = page();
    const key = (key: string, mods: Record<string, boolean> = {}) => p.fire("keydown", { key, ...mods });
    assert.equal(key("F5"), true);
    assert.equal(key("r", { ctrlKey: true }), true);
    assert.equal(key("R", { ctrlKey: true, shiftKey: true }), true);
    assert.equal(key("ArrowLeft", { altKey: true }), true);
    assert.equal(key("BrowserBack"), true);
    assert.equal(key("r"), false, "typing an r is untouched");
    assert.equal(key("ArrowLeft"), false, "the arrow keys still move");
    assert.equal(key("p", { ctrlKey: true }), false, "Ctrl+P is the app's own (search files)");
    assert.equal(p.fire("mouseup", { button: 3 }), true, "the mouse's back button");
    assert.equal(p.fire("mouseup", { button: 0 }), false);
  });

  it("marks the page in the desktop app, and does nothing in a browser", () => {
    assert.equal(page().document.documentElement.dataset.desktop, "");
    const browser = page({ desktop: false });
    assert.equal(browser.document.documentElement.dataset.desktop, undefined);
    assert.equal(browser.on.contextmenu, undefined);
    assert.equal(browser.on.keydown, undefined);
  });
});
