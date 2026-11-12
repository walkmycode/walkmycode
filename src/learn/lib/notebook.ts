/**
 * The notebook: one commonplace book for every course and lesson
 * (docs/LEARNING.md, "Sporadic journaling"). Thoughts and saved answers go in
 * as they come, newest first, unsorted on purpose; each remembers where it was
 * written.
 */
export type Note = {
  id: string;
  text: string;
  at: number;
  /** A thought of the student's own, or an answer of the professor's they kept. */
  from: "you" | "prof";
  lessonId?: string;
  lessonTitle?: string;
  course?: string;
};

export const NOTES_MAX = 500;
export const NOTE_MAX = 8000;

/** The notebook with a note added at the top; nothing is added for empty text, or twice for the same saved answer. */
export function addNote(notes: Note[], note: Omit<Note, "text"> & { text: string }): Note[] {
  const text = note.text.trim().slice(0, NOTE_MAX);
  if (!text) return notes;
  if (note.from === "prof" && notes.some((n) => n.from === "prof" && n.text === text && n.lessonId === note.lessonId)) return notes;
  return [{ ...note, text }, ...notes].slice(0, NOTES_MAX);
}

export const removeNote = (notes: Note[], id: string) => notes.filter((n) => n.id !== id);

/** The notes that mention every word typed, in any order. */
export function searchNotes(notes: Note[], query: string): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return notes;
  return notes.filter((n) => {
    const hay = `${n.text} ${n.lessonTitle ?? ""} ${n.course ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "just now", "5 min ago", "yesterday", "12 Mar". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, now - at) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
