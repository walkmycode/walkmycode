// GET /api/projects/:id: one project's name, for the project page's title.
import { getProject } from "@/lib/projects";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) return Response.json({ error: "No such project" }, { status: 404 });
  return Response.json(project);
}
