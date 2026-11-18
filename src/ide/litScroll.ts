// When the editor scrolls to its highlighted lines (a tour step, a citation, a card's lines): when the
// highlight is a new one, or when the document was just replaced from outside (the file's text
// arriving after its highlight). Never because the user typed: each keystroke gives the editor a new
// `value`, which must not jump the view back to the highlight. No React here, so tests can load it.

/** Whether to light and scroll to `key` now: `done` is the last one scrolled to, `replaced` whether the
 * text was replaced from outside since. */
export function litScrollDue(key: string, done: string, replaced: boolean): boolean {
  return key !== done || replaced;
}
