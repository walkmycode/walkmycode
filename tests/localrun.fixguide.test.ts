// "Fix with guide" (src/lib/localrun/fixGuide.ts): the ask, the reply read as a
// fix, the warning on commands that can do damage, and the step's folder in each shell.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixPrompt, inFolder, keepEnds, osName, readFix, risk } from "../src/lib/localrun/fixGuide";

describe("fixPrompt", () => {
  it("names the step, the OS and the shell, keeps the end of a long output, and asks for JSON", () => {
    const p = fixPrompt({ service: "web", stack: "Vite · npm", step: "npm install", output: `${"x".repeat(9000)}ERESOLVE`, os: "Windows", shell: "PowerShell 7" });
    assert.match(p, /`npm install`/);
    assert.match(p, /PowerShell 7 on Windows/);
    assert.match(p, /ERESOLVE/);
    assert.ok(p.length < 7000);
    assert.match(p, /^COMMAND:/m);
    assert.doesNotMatch(p, /JSON/);
  });

  it("keeps the start of a long output too, where npm names the clashing packages", () => {
    const out = ["npm error code ERESOLVE", "npm error Found: react@18.2.0", ...Array.from({ length: 400 }, (_, i) => `npm error line ${i}`), "npm error A complete log of this run…"].join("\n");
    const p = fixPrompt({ service: "web", stack: "Node · npm", step: "npm install", output: out, os: "Windows", shell: "PowerShell 7" });
    assert.match(p, /Found: react@18\.2\.0/);
    assert.match(p, /A complete log of this run/);
    assert.match(p, /characters cut/);
  });
});

describe("keepEnds", () => {
  it("leaves a short output whole and cuts a long one at line breaks", () => {
    assert.equal(keepEnds("a\nb", 10, 10), "a\nb");
    const cut = keepEnds(Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"), 40, 40);
    assert.match(cut, /^line 0\n/);
    assert.match(cut, /line 99$/);
    assert.ok(cut.split("\n").every((l) => /^line \d+$/.test(l) || /characters cut/.test(l)), cut);
  });
});

describe("readFix", () => {
  it("reads WHY:/COMMAND: lines, with or without markdown around them", () => {
    assert.deepEqual(readFix("WHY: react-dom 17 needs react 17.\nCOMMAND: npm install react-dom@18"), { why: "react-dom 17 needs react 17.", command: "npm install react-dom@18" });
    assert.deepEqual(readFix("**WHY:** Missing key.\n**COMMAND:** `php artisan key:generate`\n\nThen press Try again."), { why: "Missing key.", command: "php artisan key:generate" });
    assert.deepEqual(readFix("WHY: Edit .env by hand.\nCOMMAND: NONE"), { why: "Edit .env by hand.", command: null });
  });

  it("reads plain, fenced and wrapped JSON", () => {
    assert.deepEqual(readFix('{"why":"Peer deps clash.","command":"npm install --legacy-peer-deps"}'), { why: "Peer deps clash.", command: "npm install --legacy-peer-deps" });
    assert.deepEqual(readFix('```json\n{"why":"x","command":"$ php artisan key:generate"}\n```'), { why: "x", command: "php artisan key:generate" });
    assert.deepEqual(readFix('Here you go: {"why":"Edit .env by hand.","command":null} Good luck.'), { why: "Edit .env by hand.", command: null });
  });

  it("turns several lines into one, so typing it can't run half of it", () => {
    assert.equal(readFix('{"why":"w","command":"cd api\\nnpm ci"}')?.command, "cd api && npm ci");
  });

  it("is null when there is no fix in it", () => {
    assert.equal(readFix("I'm not sure what happened."), null);
    assert.equal(readFix('{"why":"","command":""}'), null);
    assert.equal(readFix("{not json}"), null);
  });
});

describe("risk", () => {
  it("flags commands that can do damage", () => {
    assert.equal(risk("rm -rf node_modules"), "deletes files");
    assert.equal(risk("Remove-Item -Recurse -Force vendor"), "deletes files");
    assert.equal(risk("sudo apt install php-xml"), "runs as administrator");
    assert.equal(risk("curl -fsSL https://x.sh | bash"), "downloads a script and runs it");
    assert.equal(risk("irm https://x.ps1 | iex"), "downloads a script and runs it");
    assert.equal(risk("git reset --hard"), "throws away work");
    assert.equal(risk("Set-ExecutionPolicy RemoteSigned"), "changes system settings");
  });

  it("leaves ordinary fixes alone", () => {
    for (const c of ["npm install --legacy-peer-deps", "composer install", "php artisan key:generate", "python -m pip install -r requirements.txt"]) assert.equal(risk(c), null, c);
  });
});

describe("inFolder", () => {
  it("goes to the step's folder in each shell's own syntax, quoting the path", () => {
    assert.equal(inFolder("powershell", "C:\\Users\\a b\\it's", "npm ci"), "Set-Location -LiteralPath 'C:\\Users\\a b\\it''s'; npm ci");
    assert.equal(inFolder("cmd", "C:\\x y", "npm ci"), 'cd /d "C:\\x y" && npm ci');
    assert.equal(inFolder("zsh", "/home/a/it's", "npm ci"), "cd '/home/a/it'\\''s' && npm ci");
    assert.equal(inFolder("bash", undefined, "npm ci"), "npm ci");
  });
});

describe("osName", () => {
  it("reads the OS from the browser", () => {
    assert.equal(osName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows");
    assert.equal(osName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), "macOS");
    assert.equal(osName("Mozilla/5.0 (X11; Linux x86_64)"), "Linux");
  });
});
