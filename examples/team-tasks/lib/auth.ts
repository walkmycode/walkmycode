// Signing in and out: a session row in the database, its token in a cookie.
import { cookies } from "next/headers";
import { prisma } from "./db";
import { checkPassword } from "./password";

const COOKIE = process.env.SESSION_COOKIE ?? "tt_session";
const WEEK = 7 * 24 * 60 * 60 * 1000;

export async function signIn(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await checkPassword(password, user.password))) return null;
  const session = await prisma.session.create({
    data: { token: crypto.randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + WEEK) },
  });
  (await cookies()).set(COOKIE, session.token, { httpOnly: true, sameSite: "lax", path: "/" });
  return { id: user.id, name: user.name };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.delete({ where: { token } });
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Every API route that changes data calls this first. */
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}
