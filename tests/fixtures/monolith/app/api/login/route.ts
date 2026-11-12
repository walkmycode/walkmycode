// POST /api/login: checks the token and answers with a yes or no.
import { verify } from "@/lib/auth";

export async function POST(req: Request) {
  const ok = await verify(await req.text());
  return Response.json({ ok });
}
