// Reading installers' output for progress (src/ide/localrun/setup/progress.ts):
// real lines from pip, pnpm, npm, composer and pub, split across chunks.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { failureExcerpt, readChunk, startProgress } from "../src/ide/localrun/setup/progress";

describe("setup progress", () => {
  it("pip: collecting counts unique packages and never runs back; installing sets the total; success fills it", () => {
    let p = startProgress("pip", 3);
    p = readChunk("pip", p, "Collecting fastapi==0.110 (from -r requirements.txt (line 1))\n  Downloading fastapi-0.110.0-py3-none-any.whl (91 kB)\nCollecting uvi");
    assert.equal(p.pkg, "fastapi");
    assert.equal(p.phase, "Downloading");
    p = readChunk("pip", p, "corn[standard]>=0.29\nCollecting starlette<0.37 (from fastapi)\n");
    assert.equal(p.done, 3);
    assert.deepEqual(p.seen, ["fastapi", "uvicorn", "starlette"]);
    const mid = p.fraction!;
    assert.ok(mid > 0 && mid <= 0.6);
    p = readChunk("pip", p, "Installing collected packages: starlette, uvicorn, fastapi\n");
    assert.equal(p.phase, "Installing");
    assert.equal(p.total, 3);
    assert.ok(p.fraction! >= mid);
    p = readChunk("pip", p, "Successfully installed fastapi-0.110.0 starlette-0.36.3 uvicorn-0.29.0\n");
    assert.equal(p.fraction, 1);
    assert.equal(p.summary, "3 packages installed");
  });

  it("pnpm: the total from 'Packages: +N', the fraction from 'added'", () => {
    let p = startProgress("pnpm");
    p = readChunk("pnpm", p, "Packages: +200\n++++++\nProgress: resolved 120, reused 100, downloaded 20, added 50\n");
    assert.equal(p.total, 200);
    assert.equal(p.fraction, 0.25);
    p = readChunk("pnpm", p, "Progress: resolved 200, reused 180, downloaded 20, added 200, done\nDone in 4.2s\n");
    assert.equal(p.fraction, 1);
    assert.equal(p.summary, "200 packages added");
  });

  it("npm: no figure until the end (the bar sweeps), deprecations tick past, 'added N' fills it", () => {
    let p = startProgress("npm", 12);
    p = readChunk("npm", p, "npm warn deprecated inflight@1.0.6: This module is not supported\n");
    assert.equal(p.pkg, "inflight");
    p = readChunk("npm", p, "\nadded 459 packages, and audited 460 packages in 12s\n");
    assert.equal(p.fraction, 1);
    assert.equal(p.summary, "added 459 packages");
  });

  it("composer: installs counted against 'Package operations'", () => {
    let p = startProgress("composer");
    p = readChunk("composer", p, "Package operations: 4 installs, 0 updates, 0 removals\n  - Installing psr/log (3.0.0): Extracting archive\n  - Installing monolog/monolog (3.5.0): Extracting archive\n");
    assert.equal(p.done, 2);
    assert.equal(p.fraction, 0.5);
    assert.equal(p.pkg, "monolog/monolog");
  });

  it("artisan migrate: each DONE migration counts, the migration table doesn't", () => {
    let p = startProgress("artisan", 2);
    p = readChunk("artisan", p, "\n   INFO  Preparing database.\n\n  Creating migration table ........................ 12.10ms DONE\n\n   INFO  Running migrations.\n\n  0001_01_01_000000_create_users_table ............ 25.88ms DONE\n");
    assert.equal(p.done, 1);
    assert.equal(p.fraction, 0.5);
    assert.equal(p.pkg, "0001_01_01_000000_create_users_table");
    p = readChunk("artisan", p, "  2026_10_02_000000_create_todos_table ............ 8.01ms DONE\n");
    assert.equal(p.fraction, 1);
    assert.equal(p.summary, "2 tables made");
  });

  it("the failure excerpt centres on the last error line", () => {
    const log = ["Collecting a", "Collecting b", "Downloading b", "ERROR: Could not find a version that satisfies the requirement nope==9", "ERROR: No matching distribution found for nope==9", "", "notice: done"].join("\n");
    const e = failureExcerpt(log, 4);
    assert.equal(e.lines[e.hot], "ERROR: No matching distribution found for nope==9");
    assert.equal(e.lines.length, 4);
  });
});
