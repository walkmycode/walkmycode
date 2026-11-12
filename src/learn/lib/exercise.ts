/**
 * Marking an exercise from what its own tests printed (docs/LEARNING.md,
 * "Test knowledge": experience first). The tests are the course author's, run
 * by the toolchain on this computer; this reads their verdict, so a pass is a
 * fact and needs no AI.
 */
import type { CodeCheck } from "./types";

/** How many tests an exercise's starter carries (Rust's #[test]). */
export const testsIn = (code: string) => (code.match(/^\s*#\[test\]/gm) ?? []).length;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What a Rust test run (rustc --test, or cargo test) says about the work:
 * passed with every test green, not passed with the failing tests or the first
 * compiler error named. Null when the output is not a test run's.
 */
export function testVerdict(output: string, expected = 0): CodeCheck | null {
  const text = output.replace(/\r\n/g, "\n");
  const result = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/.exec(text);
  if (result) {
    const passed = Number(result[2]);
    const failed = Number(result[3]);
    if (result[1] === "ok" && failed === 0) {
      if (passed === 0) return { passed: false, feedback: "The file compiled, but it has no tests to run." };
      // The exercise's own tests are the judge: all of them, not the ones left in.
      if (passed < expected) return { passed: false, feedback: `Only ${passed} of the exercise's ${expected} tests ran. Put the missing tests back (Reset code shows them all), then run them again.` };
      return { passed: true, feedback: `${passed === 1 ? "The test passes" : `All ${passed} tests pass`}. This is your own working answer: compare it with the course's solution if you like.` };
    }
    const names = [...text.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((m) => m[1].replace(/^tests::/, ""));
    const which = names.length ? `: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}` : "";
    if (/not yet implemented/.test(text)) return { passed: false, feedback: `${plural(passed, "test")} pass, ${failed} still fail${failed === 1 ? "s" : ""}. A todo!() is still waiting to be written: that is the place to start.` };
    return { passed: false, feedback: `${plural(passed, "test")} pass, ${failed} still fail${failed === 1 ? "s" : ""}${which}. Read the first failure's "left" and "right" values: they show what your code returned and what was expected.` };
  }
  const error = /^error(\[E\d+\])?: (.+)$/m.exec(text);
  if (error) return { passed: false, feedback: `It does not compile yet${error[1] ? ` (${error[1].slice(1, -1)})` : ""}: ${error[2].trim()}. Read the first error from the top; the arrows point at the exact spot.` };
  // A todo!() left in place panics before any result line.
  if (/not yet implemented|panicked at/.test(text)) return { passed: false, feedback: "The program panicked before the tests finished. Look for a todo!() still waiting to be written." };
  return null;
}
