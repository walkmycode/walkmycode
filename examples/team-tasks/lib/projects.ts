// Projects: the dashboard lists them, each one holds tasks.
import { prisma } from "./db";

export async function listProjects() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { tasks: true } } },
  });
  return projects.map((p) => ({ id: p.id, name: p.name, tasks: p._count.tasks }));
}

export async function getProject(id: string) {
  return prisma.project.findUnique({ where: { id } });
}

export async function createProject(name: string) {
  return prisma.project.create({ data: { name } });
}
