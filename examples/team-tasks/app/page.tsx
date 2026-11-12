"use client";
// The dashboard: every project, with how many tasks it has.
import { useEffect, useState } from "react";
import Link from "next/link";
import { errorOf, type ProjectRow } from "@/lib/types";

export default function Dashboard() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects").then(async (r) => (r.ok ? setProjects(await r.json()) : setError(await errorOf(r))));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!projects) return <p>Loading projects…</p>;
  return (
    <>
      <h1>Your projects</h1>
      {projects.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className="card" style={{ display: "block" }}>
          <b>{p.name}</b> · {p.tasks} tasks
        </Link>
      ))}
    </>
  );
}
