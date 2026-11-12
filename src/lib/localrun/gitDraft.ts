// "Write it for me" in Source Control (src/ide/localrun/git): what the guide is
// asked for a commit message, and its reply tidied into one.

/** The diff, and the house rules for a commit message. */
export function draftPrompt(diff: string): string {
  return [
    "Write a git commit message for the changes below.",
    "First line: what the change does, in the imperative, at most 60 characters, no full stop.",
    "If it needs more, a blank line and then one to three short lines saying why.",
    "Reply with the message only: no quotes, no code fence, no preamble.",
    "",
    diff,
  ].join("\n");
}

/** The model's reply as a commit message: fences, wrapping quotes and a "Commit message:" label taken off. */
export function cleanDraft(text: string): string {
  return text
    .replace(/^```[a-z]*\s*$/gim, "")
    .replace(/^\s*(commit message|message)\s*:\s*/i, "")
    .trim()
    .replace(/^["'`]([\s\S]*)["'`]$/, "$1")
    .trim();
}
