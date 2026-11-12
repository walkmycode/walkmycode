"use client";
// A one-line message that shows for a few seconds ("Pop-ups are blocked
// here: floated instead."). `toast()` can be called from anywhere.
import { useEffect, useState } from "react";

const listeners = new Set<(msg: string) => void>();

export function toast(msg: string) {
  for (const l of listeners) l(msg);
}

export default function Toast() {
  const [msg, setMsg] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    const on = (text: string) => setMsg({ text, at: Date.now() });
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={msg.at}>
      {msg.text}
    </div>
  );
}
