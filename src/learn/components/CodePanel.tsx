"use client";
/**
 * The Learn room's Code room and lesson exercises: WalkMyCode's one IDE panel
 * (src/ide), set up for Python the student writes.
 */
import type { Sample } from "@/learn/lib/claude";
import type { Board, CodeCheck, Lesson, Profile } from "@/learn/lib/types";
import Ide from "@/ide/Ide";

type Props = {
  /** The language the student writes; Python unless the exercise says otherwise. */
  language?: "python" | "javascript" | "typescript" | "sql" | "rust";
  code: string;
  starter: string;
  onCode: (code: string) => void;
  sample: Sample | null;
  profile: Profile;
  lesson?: Lesson;
  board?: Board;
  check?: CodeCheck;
  onCheck?: (c: CodeCheck) => void;
  speak?: (text: string) => Promise<void>;
  /** A run ended: what it printed, and whether it was the exercise's own tests. */
  onRan?: (output: string, o: { test: boolean }) => void;
};

export default function CodePanel({ language = "python", code, starter, onCode, sample, profile, lesson, board, check, onCheck, speak, onRan }: Props) {
  return (
    <Ide
      language={language}
      value={code}
      onChange={onCode}
      starter={starter}
      sample={sample}
      profile={profile}
      lesson={lesson}
      board={board}
      check={check}
      onCheck={onCheck}
      speak={speak}
      onRan={onRan}
    />
  );
}
