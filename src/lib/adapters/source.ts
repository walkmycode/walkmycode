// Saving a file in WalkMyCode Lite. A folder read with <input webkitdirectory> or
// dropped on the page cannot be written back, and a page inside Claude never
// downloads by itself: the file is offered through Claude's download prompt
// (the viewer confirms the name), and copied to the clipboard where that is
// not possible.
import { claudeCapability } from "./runtime";

/** Text types Claude's download prompt accepts (downloads.d.ts); code goes as .txt. */
const OFFERABLE = /\.(txt|json|md|csv|html|svg)$/i;

/** The name a saved file is offered under: its own when Claude accepts that type, else with .txt added. */
export function downloadName(path: string): string {
  const name = path.split("/").pop() || "file";
  return OFFERABLE.test(name) ? name : `${name}.txt`;
}

type Downloads = { save(r: { filename: string; data: string | Blob }): Promise<{ status: "saved" | "delivered" }> };

/** Copy text: the clipboard API where the frame may use it, else the older copy command. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export type Offered = { kind: "downloaded" | "copied"; why: string } | { kind: "denied"; why: string };

/** Offer a saved file: Claude's download prompt first, then the clipboard. */
export async function offerFile(path: string, text: string): Promise<Offered> {
  const name = path.split("/").pop() || "file";
  const downloads = await claudeCapability<Downloads>("downloads");
  if (downloads) {
    try {
      await downloads.save({ filename: downloadName(path), data: text });
      return { kind: "downloaded", why: `Kept your change here and saved it as ${downloadName(path)}. WalkMyCode Lite can't write into your folder, so put the file back in your project yourself.` };
    } catch {
      // Declined, or saving is not offered on this view: copy instead.
    }
  }
  if (await copyText(text)) return { kind: "copied", why: `Kept your change here and copied ${name} to the clipboard. WalkMyCode Lite can't write into your folder, so paste it into your editor.` };
  return { kind: "denied", why: "WalkMyCode Lite can't write into your folder, and the copy was blocked. Select the text in the editor and copy it yourself." };
}
