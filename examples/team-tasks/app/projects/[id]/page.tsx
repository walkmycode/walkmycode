"use client";
// One project: its tasks, and the form to add one.
import { use, useCallback, useEffect, useState } from "react";
import TaskList from "@/components/TaskList";
import NewTaskForm from "@/components/NewTaskForm";
import type { TaskRow } from "@/lib/types";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const reload = useCallback(() => {
    void fetch(`/api/projects/${id}/tasks`)
      .then((r) => r.json())
      .then(setTasks);
  }, [id]);
  useEffect(reload, [reload]);

  return (
    <>
      <h1>Tasks</h1>
      <NewTaskForm projectId={id} onAdded={reload} />
      <TaskList tasks={tasks} onChange={reload} />
    </>
  );
}
