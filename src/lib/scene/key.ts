/**
 * The picture key of a diagram. A diagram that backs an analogy names each
 * box twice, the real name and then the analogy's word for it after a <br/>
 * ("s1<br/>Emily": DIAGRAM_RULES in src/learn/lib/professor.ts). This reads
 * those pairs out of the Mermaid source, so any diagram (class, state, flow,
 * ER, sequence) can show under it what stands for what, drawn with the same
 * drawings as an analogy scene (src/components/scene/PictureKey.tsx).
 *
 * In the Explore guide a box's second line is its file instead
 * ("LoginForm<br/>components/LoginForm.tsx"): that is not a picture, and is
 * left out.
 */
export type KeyPair = { real: string; picture: string };

const LABEL = /([^\[\](){}"<>|:;\n]+?)\s*<br\s*\/?>\s*([^\[\](){}"<>|:;\n]+)/g;
/** A file or a path: has a slash, or ends like a file name. */
const FILE = /[\\/]|\.[a-z0-9]{1,5}$/i;

export function pictureKey(source: string, max = 8): KeyPair[] {
  const out: KeyPair[] = [];
  for (const m of source.matchAll(LABEL)) {
    // A node's id comes before its label: "A[s1<br/>Emily]" and "participant s1 as s1<br/>Emily" both end in the label.
    const real = m[1].trim().split(/\s+as\s+/).at(-1)!.trim();
    const picture = m[2].trim();
    if (!real || !picture || FILE.test(picture) || real.length > 60 || picture.length > 60) continue;
    if (out.some((p) => p.picture.toLowerCase() === picture.toLowerCase())) continue;
    out.push({ real, picture });
    if (out.length === max) break;
  }
  return out;
}
