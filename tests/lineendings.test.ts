// The code pane and line endings (src/shell/panels/lineEndings.ts): CodeMirror
// gives a "\r\n" file back with "\n" endings, so opening one must not count as
// an edit, and Save must write the file's own endings back.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState } from "@codemirror/state";
import { eolOf, toLF, withEol } from "../src/shell/panels/lineEndings";

const crlf = 'from fastapi import APIRouter\r\n\r\nrouter = APIRouter()\r\n\r\n@router.get("/calendar/events")\r\ndef events():\r\n    return []\r\n';
/** What the editor hands back through onChange for a document made from `text`. */
const echo = (text: string) => EditorState.create({ doc: text }).doc.toString();

describe("line endings in the code pane", () => {
  it("the editor's echo of a CRLF file is the file with LF endings, so it is not a change", () => {
    assert.notEqual(echo(crlf), crlf, "CodeMirror normalises endings: this is why opening looked like an edit");
    assert.equal(echo(crlf), toLF(crlf));
    // CodePanel compares drafts with toLF(content) and gives the editor that same text.
    assert.equal(echo(toLF(crlf)), toLF(crlf));
  });

  it("toLF turns \\r\\n and a lone \\r into \\n and leaves LF text as it is", () => {
    assert.equal(toLF("a\r\nb\rc\nd"), "a\nb\nc\nd");
    const lf = "a\nb\n";
    assert.equal(toLF(lf), lf);
  });

  it("eolOf picks the ending most lines use", () => {
    assert.equal(eolOf(crlf), "\r\n");
    assert.equal(eolOf("a\nb\n"), "\n");
    assert.equal(eolOf("a\rb\r"), "\r");
    assert.equal(eolOf("one line"), "\n");
    assert.equal(eolOf("a\r\nb\r\nc\nd"), "\r\n");
    assert.equal(eolOf("a\r\nb\nc\n"), "\n");
    assert.equal(eolOf("a\r\nb\n"), "\n", "a tie is LF");
  });

  it("saving the unchanged echo writes the file back byte for byte", () => {
    for (const file of [crlf, toLF(crlf), "a\rb\r", "no ending", ""]) {
      assert.equal(withEol(echo(file), eolOf(file)), file);
    }
  });

  it("an edited CRLF file is saved with CRLF endings, the new line too", () => {
    const edited = echo(crlf).replace("    return []\n", "    return []\n# soon: filters\n");
    assert.notEqual(edited, toLF(crlf), "a real edit is still a change");
    const saved = withEol(edited, eolOf(crlf));
    assert.equal(saved, crlf + "# soon: filters\r\n");
    assert.ok(!/[^\r]\n/.test(saved), "no bare \\n left");
  });

  it("withEol does not double a \\r that is already there", () => {
    assert.equal(withEol("a\r\nb\n", "\r\n"), "a\r\nb\r\n");
  });
});
