// Line endings in the code pane, without touching the shared editor.
// CodeMirror keeps a document as lines and gives its text back joined with
// "\n", so a file with Windows "\r\n" endings would come back different from
// the file although nobody typed a thing (and show "Unsaved changes"). The
// pane gives the editor "\n" text, so a draft differs from the file only when
// its lines do, and Save writes the file back with the endings it had.

export type Eol = "\n" | "\r\n" | "\r";

/** The text with every line ending as "\n": CodeMirror splits lines at \r\n, \r and \n. */
export function toLF(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** The ending most of the file's lines use; "\n" for a file with none, or on a tie. */
export function eolOf(text: string): Eol {
  let crlf = 0;
  let cr = 0;
  let lf = 0;
  for (const [m] of text.matchAll(/\r\n|\r|\n/g)) {
    if (m === "\r\n") crlf++;
    else if (m === "\r") cr++;
    else lf++;
  }
  if (crlf > lf && crlf >= cr) return "\r\n";
  if (cr > lf && cr > crlf) return "\r";
  return "\n";
}

/** Editor text as it goes back into a file that uses `eol`: every line ends with `eol`. */
export function withEol(text: string, eol: Eol): string {
  const lf = toLF(text);
  return eol === "\n" ? lf : lf.replace(/\n/g, eol);
}
