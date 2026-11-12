// Browser preferences under the walkmycode.* / walkmycode:* keys, read with
// a fallback to the key's name before the rename (lantern.* / lantern:*), so
// settings saved then keep working. Writes go to the new key only; clearing a
// preference clears both, or the old value would come back. Callers guard
// every access themselves (private mode, blocked storage).

/** The key's name before the rename: walkmycode.motion → lantern.motion. */
export function oldPrefKey(key: string): string {
  return key.replace(/^walkmycode(?=[.:])/, "lantern");
}

/** The saved value, or the one saved under the old key when there is none. */
export function readPref(store: Pick<Storage, "getItem">, key: string): string | null {
  return store.getItem(key) ?? store.getItem(oldPrefKey(key));
}

/** Clears the preference under both names. */
export function removePref(store: Pick<Storage, "removeItem">, key: string): void {
  store.removeItem(key);
  const old = oldPrefKey(key);
  if (old !== key) store.removeItem(old);
}
