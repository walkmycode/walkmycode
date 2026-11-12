// A per-launch token compared in constant time.
import { timingSafeEqual } from "node:crypto";

export function sameToken(given: string | null | undefined, token: string): boolean {
  if (!given || !token) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
