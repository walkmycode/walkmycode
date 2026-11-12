"use client";
// One task and the comments on it.
import { use, useEffect, useState } from "react";
import CommentBox from "@/components/CommentBox";
import type { CommentRow } from "@/lib/types";

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [comments, setComments] = useState<CommentRow[]>([]);

  useEffect(() => {
    void fetch(`/api/tasks/${id}/comments`)
      .then((r) => r.json())
      .then(setComments);
  }, [id]);

  return (
    <>
      <h1>Comments</h1>
      {comments.map((c) => (
        <p key={c.id} className="card">
          <b>{c.author.name}:</b> {c.body}
        </p>
      ))}
      <CommentBox taskId={id} onPosted={(c) => setComments((all) => [...all, c])} />
    </>
  );
}
