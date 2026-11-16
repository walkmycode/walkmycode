/**
 * A scene of any kind: the hand-over (model.ts's Scene, where holders pass things on) or one of the kinds in
 * kinds.ts. A scene written before the kinds has no "kind" and is a hand-over, so lessons keep theirs.
 */
import { cleanScene, readSceneBlock, type Scene } from "./model";
import { cleanKindScene, SCENE_KINDS, type KindScene } from "./kinds";

export type AnyScene = Scene | KindScene;

const kindOf = (raw: unknown): string => {
  const k = (raw as { kind?: unknown } | null)?.kind;
  return typeof k === "string" ? k.trim().toLowerCase() : "";
};
const isKind = (k: string) => (SCENE_KINDS as readonly string[]).includes(k);

export const isKindScene = (s: AnyScene): s is KindScene => isKind(kindOf(s));

/** Keep only a scene of any kind the page can draw; null otherwise. `language` is null for a subject without code. */
export function cleanAnyScene(raw: unknown, language: string | null): AnyScene | null {
  return isKind(kindOf(raw)) ? cleanKindScene(raw, language) : cleanScene(raw, language);
}

/** A ```scene block from an answer, of any kind; null if it is not one (still arriving, or not valid). */
export function readAnySceneBlock(text: string): AnyScene | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isKind(kindOf(raw))) return readSceneBlock(text);
  const lang = (raw as { language?: unknown } | null)?.language;
  const language = typeof lang === "string" ? lang.trim().toLowerCase() : "";
  // Code with no language named is still code, shown as plain text; "none" means a subject without code.
  const hasCode = typeof (raw as { code?: unknown }).code === "string";
  return cleanKindScene(raw, ["none", "plain", "words"].includes(language) ? null : language || (hasCode ? "text" : null));
}
