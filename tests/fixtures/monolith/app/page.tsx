"use client";
// The one screen: a sign-in button that posts to the login route.
import { useState } from "react";

export default function Page() {
  const [who, setWho] = useState<string | null>(null);

  async function signIn() {
    const r = await fetch("/api/login", { method: "POST" });
    setWho(await r.text());
  }

  return (
    <main>
      <button onClick={signIn}>Sign in</button>
      {who && <p>{who}</p>}
    </main>
  );
}
