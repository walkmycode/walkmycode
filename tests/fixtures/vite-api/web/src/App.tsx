// Notes: a list, a button that adds one, and one note opened.
import { useState } from "react";
import { apiFetch } from "./lib/api";

export default function App() {
  const [notes, setNotes] = useState<unknown[]>([]);

  async function load() {
    const r = await fetch(`${import.meta.env.VITE_API_URL}/notes`);
    setNotes(await r.json());
  }

  async function add() {
    await apiFetch("/notes", { method: "POST", body: "{}" });
  }

  async function open(id: number) {
    return apiFetch(`/notes/${id}`, { method: "GET" });
  }

  return (
    <main>
      <button onClick={load}>Load notes</button>
      <button onClick={add}>Add a note</button>
      <button onClick={() => open(1)}>Open the first</button>
      <pre>{JSON.stringify(notes)}</pre>
    </main>
  );
}
