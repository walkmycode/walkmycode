// GET /api/me: who is signed in (the header shows their name).
import { currentUser } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ id: user.id, name: user.name });
}
