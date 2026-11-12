"use client";
// "Add task": the title box and the button that sends the new task to the API.
import { useState } from "react";
import { errorOf } from "@/lib/types";

export default function NewTaskForm({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setBusy(false);
    if (!r.ok) return setError(await errorOf(r));
    setTitle("");
    onAdded();
  }

  return (
    <form onSubmit={add} className="card">
      <input placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={busy || !title.trim()}>
        Add task
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
