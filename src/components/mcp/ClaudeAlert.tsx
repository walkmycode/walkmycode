"use client";
// A strip under the top bar when the page can't be answered (src/lib/bridge/client.ts claudeAlert):
// the AI app stopped listening (its turn ended), with the word that brings it back and a Copy for
// it, or WalkMyCode's server is gone. The pill says it too, but a pill is easy to miss (and narrow
// screens show only its dot). It waits a few seconds first, so a page still connecting or a client
// between two polls never flashes it; it goes by itself when things are fine, or on ×.
import { useEffect, useState } from "react";
import { claudeAlert } from "@/lib/bridge/client";
import { useBridge } from "@/lib/bridge/page";

const SHOW_AFTER_MS = 5_000;

export default function ClaudeAlert() {
  const snap = useBridge();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const alert = claudeAlert(snap, now);
  const key = alert ? `${alert.kind}:${alert.text}` : null;
  // When this alert began (a new one starts the wait again); hidden ones show again once things were fine.
  const [since, setSince] = useState<{ key: string | null; at: number }>({ key: null, at: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (since.key !== key) {
    setSince({ key, at: now });
    if (!key) setDismissed(null);
  }

  if (!alert || since.key !== key || now - since.at < SHOW_AFTER_MS || dismissed === key) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(alert.say ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // the word is on screen to type
    }
  };
  return (
    <div className={`claude-alert ${alert.kind}`} role="alert">
      <span className="dot bad" aria-hidden />
      <p>{alert.text}</p>
      {alert.say && (
        <button type="button" className="ctl compact" onClick={() => void copy()}>
          {copied ? "Copied ✓" : `Copy “${alert.say}”`}
        </button>
      )}
      <button type="button" className="iconbtn claude-alert-x" aria-label="Hide this" onClick={() => setDismissed(key)}>
        ×
      </button>
    </div>
  );
}
