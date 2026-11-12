// npx tsx prisma/seed.ts: one user, one project and a few tasks to start with.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";

const prisma = new PrismaClient();

async function main() {
  const ada = await prisma.user.upsert({
    where: { email: "ada@example.com" },
    update: {},
    create: { email: "ada@example.com", name: "Ada", password: hashPassword("change-me") },
  });
  const project = await prisma.project.create({ data: { name: "Launch the website" } });
  for (const title of ["Write the copy", "Pick the photos", "Set up the domain"]) {
    await prisma.task.create({ data: { title, projectId: project.id, assigneeId: ada.id } });
  }
}

main().finally(() => prisma.$disconnect());
