// GET /api/users/:id: one user by id.
import { getUser } from "@/lib/auth";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json(await getUser(id));
}
