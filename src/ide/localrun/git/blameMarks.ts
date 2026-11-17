// git blame's blocks of lines as the editor shows them (./FileGit.tsx asks for them): the gutter's
// author and date, its hover, and the note on the cursor's line (src/ide/lineHistory.ts). Dates are
// in this computer's time zone. No React here, so tests can load it.
import type { BlameMark } from "@/ide/lineHistory";
import type { GitBlameHunk } from "@/lib/localrun/git";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const AGO = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

/** "2 Nov 2026, 09:14" in this computer's time zone. */
export const shortDate = (d: Date) => DAY.format(d);

const PARTS = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** The gutter's date in pieces: "2 Nov", " 2026", "09:14". */
function dateParts(d: Date): { day: string; year: string; time: string } {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.day} ${p.month}`, year: ` ${p.year}`, time: `${p.hour}:${p.minute}` };
}

/** "two weeks ago". */
export function ago(d: Date, now = Date.now()): string {
  const s = (d.getTime() - now) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86_400, "hour"],
    [604_800, "day"],
    [2_629_800, "week"],
    [31_557_600, "month"],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [limit, unit] = steps[i];
    if (Math.abs(s) < limit) return AGO.format(Math.round(s / (i ? steps[i - 1][0] : 1)), unit);
  }
  return AGO.format(Math.round(s / 31_557_600), "year");
}

/** git's blocks of lines as the editor shows them: the user's own commits as "You", lines not committed in green. */
export function blameMarks(hunks: GitBlameHunk[], me: string, now = Date.now()): BlameMark[] {
  const mine = me.trim().toLowerCase();
  return hunks.map((h) => {
    const range = h.lines > 1 ? `lines ${h.start}–${h.start + h.lines - 1}` : `line ${h.start}`;
    if (!h.hash) return { start: h.start, lines: h.lines, who: "Not committed", when: "your change", tip: `Changed since the last commit (${range}).`, note: "Not committed yet", tone: "new" };
    const d = new Date(h.time * 1000);
    const isMe = !!mine && h.email.toLowerCase() === mine;
    const who = isMe ? "You" : h.author;
    const when = dateParts(d);
    return {
      start: h.start,
      lines: h.lines,
      who,
      when,
      tip: `${h.author}${isMe ? " (you)" : ""}\n${LONG.format(d)} · ${ago(d, now)}\n${h.summary}\n${h.hash} · ${range}`,
      note: `${who}, ${when.day}${when.year} ${when.time}${h.summary ? ` · ${h.summary}` : ""}`,
      ...(isMe ? { tone: "me" as const } : {}),
    };
  });
}
