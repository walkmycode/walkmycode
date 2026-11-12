// Tasks: the heart of the app. The API routes call these; they talk to the database.
import { prisma } from "./db";
import { sendAssignedEmail } from "./email";

export async function listTasks(projectId: string) {
  return prisma.task.findMany({
    where: { projectId },
    orderBy: [{ done: "asc" }, { createdAt: "desc" }],
    include: { assignee: { select: { id: true, name: true } } },
  });
}

export async function getTask(id: string) {
  return prisma.task.findUnique({
    where: { id },
    include: { assignee: { select: { id: true, name: true } }, project: true },
  });
}

/** A new task in a project. When it is given to someone, they get an email. */
export async function createTask(projectId: string, title: string, assigneeId?: string) {
  const task = await prisma.task.create({
    data: { projectId, title, assigneeId },
    include: { assignee: true },
  });
  if (task.assignee) await sendAssignedEmail(task.assignee.email, task.title);
  return task;
}

export async function updateTask(id: string, change: { title?: string; done?: boolean; assigneeId?: string | null }) {
  const task = await prisma.task.update({ where: { id }, data: change, include: { assignee: true } });
  if (change.assigneeId && task.assignee) await sendAssignedEmail(task.assignee.email, task.title);
  return task;
}

export async function deleteTask(id: string) {
  await prisma.comment.deleteMany({ where: { taskId: id } });
  await prisma.task.delete({ where: { id } });
}
