"use client";
// The bar at the top: the app's name, who is signed in, and Sign out.
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Header() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setName(me?.name ?? null));
  }, []);

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header style={{ display: "flex", gap: 12, padding: "10px 16px", borderBottom: "1px solid #e4e0d8" }}>
      <Link href="/">
        <b>Team Tasks</b>
      </Link>
      <span style={{ flex: 1 }} />
      {name ? (
        <>
          <span>{name}</span>
          <button onClick={signOut}>Sign out</button>
        </>
      ) : (
        <Link href="/login">Sign in</Link>
      )}
    </header>
  );
}
