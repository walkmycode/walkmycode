// The note before the browser's "Upload all files?" question: only on the
// fallback folder input (no showDirectoryPicker, which includes Lite inside
// Claude), never with the real directory picker, and "Don't show this again"
// sticks in this browser.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickSource } from "../src/lib/adapters/select";
import { FOLDER_PROMPT_OFF, folderPromptOff, showDropTip, showFolderPrompt, turnFolderPromptOff } from "../src/lib/folderPrompt";

function memory() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const blocked = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
};

describe("when the note shows", () => {
  it("shows on the fallback input: a browser without showDirectoryPicker, and Lite inside Claude", () => {
    const store = memory();
    assert.equal(showFolderPrompt(pickSource({ target: "full", directoryPicker: false }).picker, store), true);
    assert.equal(showFolderPrompt(pickSource({ target: "lite", directoryPicker: true }).picker, store), true, "Lite always uses the input");
  });

  it("never shows with the native directory picker", () => {
    assert.equal(showFolderPrompt(pickSource({ target: "full", directoryPicker: true }).picker, memory()), false);
    assert.equal(showFolderPrompt("directory", null), false);
  });

  it("shows when storage is missing or blocked (it cannot know it was turned off)", () => {
    assert.equal(showFolderPrompt("input", null), true);
    assert.equal(showFolderPrompt("input", blocked), true);
  });
});

describe("Don't show this again", () => {
  it("is kept under the new walkmycode.* key and stops the note", () => {
    const store = memory();
    assert.equal(folderPromptOff(store), false);
    turnFolderPromptOff(store);
    assert.equal(FOLDER_PROMPT_OFF, "walkmycode.folderPromptOff");
    assert.equal(store.m.get("walkmycode.folderPromptOff"), "1");
    assert.equal(folderPromptOff(store), true);
    assert.equal(showFolderPrompt("input", store), false);
  });

  it("only a saved \"1\" turns it off", () => {
    const store = memory();
    store.m.set(FOLDER_PROMPT_OFF, "0");
    assert.equal(showFolderPrompt("input", store), true);
  });

  it("does not throw when storage is blocked", () => {
    assert.doesNotThrow(() => turnFolderPromptOff(blocked));
    assert.doesNotThrow(() => turnFolderPromptOff(null));
  });
});

describe("the drop tip under the drop zone", () => {
  it("shows only where the fallback input is used and a folder can be dropped", () => {
    assert.equal(showDropTip(pickSource({ target: "full", directoryPicker: false })), true);
    assert.equal(showDropTip(pickSource({ target: "lite", directoryPicker: false })), true);
    assert.equal(showDropTip(pickSource({ target: "full", directoryPicker: true })), false, "the native picker asks nothing");
    assert.equal(showDropTip(pickSource({ target: "mcp", directoryPicker: false })), false, "the MCP page takes no drop");
  });
});
