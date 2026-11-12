// GET /api/projects: every project, for the dashboard. POST /api/projects: a new one.
import { currentUser } from "@/lib/auth";
import { createProject, listProjects } from "@/lib/projects";
import { newProject } from "@/lib/validate";

export async function GET() {
  return Response.json(await listProjects());
}

export async function POST(req: Request) {
  if (!(await currentUser())) return Response.json({ error: "Sign in first" }, { status: 401 });
  const parsed = newProject.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  return Response.json(await createProject(parsed.data.name), { status: 201 });
}
