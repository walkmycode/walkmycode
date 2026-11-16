// Searching the Files panel (mockup docs/design/files-all.html): fuzzy over every path, as you type. The letters
// must come in order; a match scores higher when they run together, start a word, or fall in the file's own name,
// and a shorter path wins a tie. Pure, so the tests drive it; fast enough for 12,000 paths on every keystroke.

export interface FileHit {
  path: string;
  score: number;
  /** Indexes into `path` of the matched letters, to light them. */
  at: number[];
}

const WORD = "/._- ";

/** How well `query` matches `path`, or null when its letters aren't all there in order. Spaces in the query are ignored. */
export function fuzzy(path: string, query: string): FileHit | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return null;
  const p = path.toLowerCase();
  const nameAt = p.lastIndexOf("/") + 1;
  // Prefer a match inside the file's name: try from the name first, then from the start.
  return best(path, p, q, nameAt) ?? best(path, p, q, 0);
}

function best(path: string, p: string, q: string, from: number): FileHit | null {
  const nameAt = p.lastIndexOf("/") + 1;
  const at: number[] = [];
  let score = 0;
  let last = -2;
  let j = 0;
  for (let i = from; i < p.length && j < q.length; i++) {
    if (p[i] !== q[j]) continue;
    // A letter that starts a word, if one comes soon, beats one in the middle: "rme" → R(EAD)ME, not paRaMEter.
    let k = i;
    if (i !== last + 1 && !(i === 0 || WORD.includes(p[i - 1]))) {
      for (let n = i + 1; n < Math.min(p.length, i + 24); n++) {
        if (p[n] === q[j] && WORD.includes(p[n - 1])) {
          // Only when the rest of the query still fits after it.
          if (fits(p, q, j + 1, n + 1)) k = n;
          break;
        }
        if (p[n] === "/") break;
      }
    }
    at.push(k);
    score += 1 + (k === last + 1 ? 5 : 0) + (k === 0 || WORD.includes(p[k - 1]) ? 4 : 0) + (k >= nameAt ? 3 : 0);
    last = k;
    i = k;
    j++;
  }
  if (j < q.length) return null;
  // The whole name matched from its start: the best there is.
  if (p.startsWith(q, nameAt)) score += 10;
  return { path, score: score - path.length * 0.02, at };
}

/** Whether q[j..] still comes in order in p[from..]. */
function fits(p: string, q: string, j: number, from: number): boolean {
  for (let i = from; i < p.length && j < q.length; i++) if (p[i] === q[j]) j++;
  return j === q.length;
}

/** The paths matching `query`, best first, and how many matched in all. `limit` caps what comes back (not the count). */
export function searchFiles(paths: readonly string[], query: string, limit = 200): { hits: FileHit[]; total: number } {
  const hits: FileHit[] = [];
  for (const path of paths) {
    const h = fuzzy(path, query);
    if (h) hits.push(h);
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { hits: hits.slice(0, limit), total: hits.length };
}
