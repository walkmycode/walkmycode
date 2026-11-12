"use client";
// One task: tick it off, open its comments, or delete it.
import Link from "next/link";
import type { TaskRow } from "@/lib/types";

export default function TaskCard({ task, onChange }: { task: TaskRow; onChange: () => void }) {
  async function toggle() {
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
    onChange();
  }

  async function remove() {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <input type="checkbox" checked={task.done} onChange={toggle} aria-label="Done" />
      <Link href={`/tasks/${task.id}`} className={task.done ? "done" : undefined} style={{ flex: 1 }}>
        {task.title}
      </Link>
      {task.assignee && <small>{task.assignee.name}</small>}
      <button onClick={remove} aria-label="Delete task">
        ×
      </button>
    </div>
  );
}
