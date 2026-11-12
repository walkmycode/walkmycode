"use client";
// Home: a button that shows one user, and a health ping on load.
import { useEffect, useState } from "react";

export default function Page() {
  const [user, setUser] = useState<unknown>(null);
  const id = 1;

  async function show() {
    const r = await fetch(`/api/users/${id}`);
    setUser(await r.json());
  }

  useEffect(() => {
    fetch("/health").catch(() => {});
  }, []);

  return (
    <main>
      <button onClick={show}>Show me</button>
      <pre>{JSON.stringify(user)}</pre>
    </main>
  );
}
