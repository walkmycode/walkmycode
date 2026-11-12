// Passwords are never stored as typed: only a salted hash.
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(plain, salt, 100_000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

export async function checkPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const again = pbkdf2Sync(plain, salt, 100_000, 32, "sha256");
  return timingSafeEqual(again, Buffer.from(hash, "hex"));
}
