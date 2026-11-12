"use client";
// Write a comment on a task and post it.
import { useState } from "react";
import type { CommentRow } from "@/lib/types";

export default function CommentBox({ taskId, onPosted }: { taskId: string; onPosted: (c: CommentRow) => void }) {
  const [body, setBody] = useState("");

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!r.ok) return;
    setBody("");
    onPosted(await r.json());
  }

  return (
    <form onSubmit={post} className="card">
      <textarea placeholder="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      <button type="submit" disabled={!body.trim()}>
        Comment
      </button>
    </form>
  );
}
