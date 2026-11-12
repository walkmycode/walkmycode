// POST /api/logout: ends the session and clears the cookie.
import { signOut } from "@/lib/auth";

export async function POST() {
  await signOut();
  return Response.json({ ok: true });
}
