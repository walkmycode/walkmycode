// Comments on a task, newest last.
import { prisma } from "./db";

export async function listComments(taskId: string) {
  return prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { name: true } } },
  });
}

export async function addComment(taskId: string, authorId: string, body: string) {
  return prisma.comment.create({ data: { taskId, authorId, body }, include: { author: { select: { name: true } } } });
}
