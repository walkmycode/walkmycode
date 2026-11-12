// The code view's Save on WalkMyCode for Claude's page (POST /api/files/save → writeWorkspaceFile,
// mcp/src/workspace.ts): the edited file goes back into the project's folder, and nothing else does.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { openWorkspace, writeWorkspaceFile, type OpenedWorkspace } from "../mcp/src/workspace";
import { FIXTURES } from "./mcp.helpers";

describe("writing an edited file back (the code view's Save)", () => {
  let dir: string;
  let home: string;
  let savedHome: string | undefined;
  let ws: OpenedWorkspace;

  before(async () => {
    savedHome = process.env.WALKMYCODE_HOME;
    home = mkdtempSync(join(tmpdir(), "wmc-save-home-"));
    process.env.WALKMYCODE_HOME = home;
    dir = join(mkdtempSync(join(tmpdir(), "wmc-save-")), "monolith");
    cpSync(join(FIXTURES, "monolith"), dir, { recursive: true });
    writeFileSync(join(dir, ".env.example"), "STRIPE_SECRET_KEY=sk_live_abcdefghijklmnop\n");
    ws = await openWorkspace([dir], {});
  });
  after(() => {
    if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
    else process.env.WALKMYCODE_HOME = savedHome;
    rmSync(join(dir, ".."), { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("writes a file it read, and keeps the new text as the one it knows", async () => {
    const text = `${ws.files["lib/auth.ts"]}\n// edited\n`;
    assert.equal(await writeWorkspaceFile(ws, "lib/auth.ts", text), null);
    assert.equal(readFileSync(join(dir, "lib", "auth.ts"), "utf8"), text);
    assert.equal(ws.files["lib/auth.ts"], text);
  });

  it("refuses a file it didn't read, and a path out of the folder", async () => {
    assert.equal((await writeWorkspaceFile(ws, "lib/new.ts", "x"))?.status, 404);
    ws.files["../escape.ts"] = "x";
    assert.equal((await writeWorkspaceFile(ws, "../escape.ts", "x"))?.status, 400);
    delete ws.files["../escape.ts"];
  });

  it("never writes back a file whose secret values the page sees hidden", async () => {
    const shown = ws.files[".env.example"];
    assert.ok(shown !== undefined && !shown.includes("sk_live_abcdefghijklmnop"), "the page sees it hidden");
    const r = await writeWorkspaceFile(ws, ".env.example", shown);
    assert.equal(r?.status, 409);
    assert.match(r!.why, /hidden/);
    assert.match(readFileSync(join(dir, ".env.example"), "utf8"), /sk_live_abcdefghijklmnop/);
  });

  it("leaves a file alone that changed on disk since it was read", async () => {
    writeFileSync(join(dir, "app", "page.tsx"), "// someone else's edit\n");
    const r = await writeWorkspaceFile(ws, "app/page.tsx", "// mine\n");
    assert.equal(r?.status, 409);
    assert.equal(readFileSync(join(dir, "app", "page.tsx"), "utf8"), "// someone else's edit\n");
  });
});
