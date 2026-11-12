// POST /api/login: checks the email and password and starts a session.
import { signIn } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const user = await signIn(String(email ?? ""), String(password ?? ""));
  if (!user) return Response.json({ error: "Wrong email or password" }, { status: 401 });
  return Response.json(user);
}
