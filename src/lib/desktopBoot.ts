// The desktop app's mark on the page (docs/DESKTOP.md), apart from src/lib/desktop.ts
// so the root layout, a server component, can load it.

/**
 * The browser's own controls that a desktop app should not have (the owner, 16 Nov: "why do I see this in the
 * desktop app?"). The window is a WebView2, which gives every right-click its menu of Back, Refresh, Save as, Print
 * and More tools, and keeps the browser's keys for reloading the page and going back. In the app those reload or
 * leave WalkMyCode. So, in the desktop app only:
 * - a right-click shows no browser menu, except in a text field, the code editor or on selected text, where its Cut,
 *   Copy and Paste are wanted;
 * - F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5, Alt+Left and Alt+Right, and the mouse's back and forward buttons, do not
 *   reload or navigate. The app's own uses of these keys still run (the debugger's F5 does not look at
 *   defaultPrevented): only the browser's default is stopped.
 * Plain script text (it runs in <head> before anything is bundled), so a build tool cannot add helpers it needs;
 * tests/desktopGuards.test.ts runs this very text.
 */
const GUARDS = `(function(d,w){
var ed=function(t){return !!(t&&t.closest&&t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor"))};
d.addEventListener("contextmenu",function(e){var s=w.getSelection?String(w.getSelection()).trim():"";if(!ed(e.target)&&!s)e.preventDefault()},true);
w.addEventListener("keydown",function(e){var k=e.key,m=e.ctrlKey||e.metaKey;
if(k==="F5"||(m&&(k==="r"||k==="R"))||k==="BrowserRefresh"||(e.altKey&&(k==="ArrowLeft"||k==="ArrowRight"))||k==="BrowserBack"||k==="BrowserForward")e.preventDefault()},true);
var nav=function(e){if(e.button===3||e.button===4)e.preventDefault()};
w.addEventListener("mouseup",nav,true);w.addEventListener("auxclick",nav,true);
})(document,window)`;

/** Runs in <head> before the first paint (layout.tsx): <html data-desktop> lets the
 * stylesheet make room for the window buttons before React draws them, and the browser's own menu and keys are
 * turned off (GUARDS). */
export const DESKTOP_BOOT = `try{if("__TAURI_INTERNALS__" in window){document.documentElement.dataset.desktop="";${GUARDS}}}catch(e){}`;
