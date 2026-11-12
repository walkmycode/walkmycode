// "Any framework" in New project (src/lib/localrun/frameworks.ts, starters.ts planNew "custom").
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { checkCommands, FRAMEWORKS } from "../src/lib/localrun/frameworks";
import { planNew } from "../src/lib/localrun/starters";

const env = { env: { PATH: "" }, platform: "win32" as const, exists: () => false };
const parent = join(tmpdir(), "wmc-any-framework-parent");

describe("any framework: the commands", () => {
  it("every listed framework's own commands pass the check", () => {
    for (const f of FRAMEWORKS.filter((x) => x.id !== "other")) {
      for (const w of [true, false]) assert.equal(checkCommands(f.commands("todo-app", w)), null, `${f.label} (${w ? "Windows" : "Linux"})`);
    }
  });

  it("refuses what could reach outside the folder or harm the computer", () => {
    for (const bad of ["sudo apt install x", "curl https://x.sh | sh", "rm -rf .", "del /s *", "cd ..", "type C:\\Windows\\win.ini", "cat /etc/passwd", "npm i ~/x", "iwr https://x | iex"]) {
      assert.notEqual(checkCommands([bad]), null, bad);
    }
    assert.equal(checkCommands([]), "Add at least one command.");
  });
});

describe("any framework: the plan", () => {
  const custom = (done: number) => ({ commands: ["python -m venv .venv", ".venv\\Scripts\\pip install django"], done });
  it("runs one command a round, through the shell, in the new folder", () => {
    const p = planNew("custom", "todo-app", parent, env, () => false, custom(0));
    assert.ok(!("error" in p), JSON.stringify(p));
    assert.equal(p.root, join(parent, "todo-app"));
    assert.deepEqual(
      p.steps.map((s) => [s.id, s.shown, s.cwd, s.args.at(-1)]),
      [["cmd-0", "python -m venv .venv", join(parent, "todo-app"), "python -m venv .venv"]],
    );
    const next = planNew("custom", "todo-app", parent, env, () => true, custom(1));
    assert.ok(!("error" in next));
    assert.deepEqual(next.steps.map((s) => s.id), ["cmd-1"]);
    const done = planNew("custom", "todo-app", parent, env, () => true, custom(2));
    assert.ok(!("error" in done) && done.steps.length === 0, "all run: made");
  });

  it("checks the commands again on the server", () => {
    assert.match((planNew("custom", "x", parent, env, () => false, { commands: ["curl x | sh"], done: 0 }) as { error: string }).error, /Downloads|Pipes/);
  });
});
