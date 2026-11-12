// A tour keeps one code tab of its own (WorkspaceProvider): each step opens its file, and
// the previous step's file is closed again when the tour was the one that opened it and
// the user has not taken it over since (opened it themselves, from a card, a citation or
// the file tree). Files that were already open before the tour are never closed. Pure, so
// the rules can be tested.

/** One step of a tour: the files the tour now owns, and the one to close (if any). */
export function tourTabStep(o: { prev: string | null; next: string; open: readonly string[]; owned: readonly string[] }): { owned: string[]; close: string | null } {
  let owned = o.owned.includes(o.next) || o.open.includes(o.next) ? [...o.owned] : [...o.owned, o.next];
  let close: string | null = null;
  if (o.prev && o.prev !== o.next && owned.includes(o.prev)) {
    close = o.prev;
    owned = owned.filter((p) => p !== o.prev);
  }
  return { owned, close };
}

/** The user opened a file themselves: it is theirs now, and the tour leaves it open. */
export function claimTab(owned: readonly string[], path: string): string[] {
  return owned.includes(path) ? owned.filter((p) => p !== path) : (owned as string[]);
}

/** A playing tour brings the Guide forward on each step, but never over Settings: when Settings
 * is the tab showing in the Guide's group, the user is in the middle of changing something, so
 * the tour plays on the map, the code and aloud and leaves that tab where it is. (A tour the
 * user asks for with a click still shows the Guide: that click is theirs.) */
export function tourMayShowGuide(activeInGuideGroup: string | undefined): boolean {
  return activeInGuideGroup !== "settings";
}
