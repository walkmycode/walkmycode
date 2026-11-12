// What the API accepts from the browser, checked before anything touches the database.
import { z } from "zod";

export const newTask = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(200),
  assigneeId: z.string().optional(),
});

export const taskChange = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  done: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
});

export const newComment = z.object({
  body: z.string().trim().min(1, "Say something first").max(2000),
});

export const newProject = z.object({
  name: z.string().trim().min(1).max(80),
});
