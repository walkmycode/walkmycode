// The secret guard every WalkMyCode-for-Claude tool result passes through
// (docs/MCP.md §6): keys of every common shape, private key blocks, passwords
// in URLs and the machine's own keys are hidden; ordinary code is not touched,
// and no line is added or lost. The fake keys are made up at run time, so no
// key-shaped string sits in this file.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { guardText, knownSecrets } from "../mcp/src/secrets";

/** A deterministic string of `n` characters from `alphabet`. */
function fake(n: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", seed = n * 7919): string {
  let x = seed;
  let s = "";
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += alphabet[x % alphabet.length];
  }
  return s;
}
const HEX = "0123456789abcdef";

const FAKE_KEYS = {
  anthropic: `sk-ant-api03-${fake(40)}`,
  openai: `sk-proj-${fake(48, undefined, 3)}`,
  stripeLive: `sk_live_${fake(24, undefined, 5)}`,
  stripeNoDigits: `sk_test_${"abcdefghijklmnop"}`,
  github: `ghp_${fake(36, undefined, 11)}`,
  aws: `AKIA${fake(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 13)}`,
  google: `AIza${fake(35, undefined, 17)}`,
  slack: `xoxb-${fake(12, "0123456789", 19)}-${fake(24, undefined, 23)}`,
  jwt: `eyJ${fake(20, undefined, 29)}.eyJ${fake(30, undefined, 31)}.${fake(30, undefined, 37)}`,
  deepgram: fake(40, HEX, 41),
  elevenlabs: `sk_${fake(48, HEX, 43)}`,
  base64: fake(64, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", 47),
};

describe("guardText", () => {
  it("hides every key shape, wherever it sits in a line", () => {
    for (const [name, key] of Object.entries(FAKE_KEYS)) {
      for (const line of [`const k = "${key}";`, `  12| headers: { "x-api-key": '${key}' }`, `${key}`, `curl -H "X: ${key}" https://x.test`]) {
        const out = guardText(line, []);
        assert.ok(!out.includes(key), `${name} survived in: ${out}`);
        assert.ok(out.includes("•••"), `${name}: nothing was hidden in ${out}`);
      }
    }
  });

  it("hides a private key block line by line and keeps its BEGIN and END lines", () => {
    const body = Array.from({ length: 4 }, (_, i) => fake(64, undefined, 100 + i));
    const pem = ["const key = `", "-----BEGIN PRIVATE KEY-----", ...body, "-----END PRIVATE KEY-----", "`;"].join("\n");
    const out = guardText(pem, []);
    for (const b of body) assert.ok(!out.includes(b));
    assert.equal(out.split("\n").length, pem.split("\n").length);
    assert.match(out, /-----BEGIN PRIVATE KEY-----\n•••\n/);
  });

  it("hides credentials after Bearer, passwords in URLs, and quoted values of secret-named settings", () => {
    const token = fake(32, undefined, 61);
    const pass = fake(16, undefined, 67);
    const val = fake(24, undefined, 71);
    const out = guardText([`Authorization: Bearer ${token}`, `const db = "postgres://admin:${pass}@db:5432/app";`, `const apiKey = "${val}";`, `{"client_secret": "${val}"}`].join("\n"), []);
    for (const s of [token, pass, val]) assert.ok(!out.includes(s), out);
    assert.match(out, /postgres:\/\/admin:•••@db:5432/);
    assert.equal(out.split("\n").length, 4);
  });

  it("hides the machine's own keys whatever they look like", () => {
    const plain = "plainwordsbutsecret";
    assert.equal(guardText(`voice: ${plain}.`, [plain]), "voice: •••.");
  });

  it("leaves ordinary code alone", () => {
    const code = [
      'import { useState } from "react";',
      'const skeletonLoaderComponentName = "SkeletonLoader";',
      'const KEY = "workspace";',
      '<div className="pk-container-wrapper-large" />',
      'fetch("/api/v1/organizations/members/invitations/accept");',
      "function handleUserAuthenticationCallbackForProviderSettings() {}",
      "verify(token: string): Promise<boolean>",
      'const tokenizer = "cl100k_base";',
      'const id = "550e8400-e29b-41d4-a716-446655440000";',
      "// Enter your password to continue",
      "  12| const x = 1;",
      "headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }",
      "const MAX_FILES_PER_WORKSPACE = 12_000;",
      'route:app/api/users/[id]/route.ts#GET /api/users/[id]',
    ].join("\n");
    assert.equal(guardText(code, []), code);
  });
});

describe("knownSecrets", () => {
  let home: string;
  const saved = process.env.WALKMYCODE_HOME;
  before(() => {
    home = mkdtempSync(join(tmpdir(), "walkmycode-guard-"));
    mkdirSync(join(home, ".walkmycode"));
    writeFileSync(join(home, ".walkmycode", "keys.env"), "ELEVENLABS_API_KEY=plainwordsbutsecret\nSHORT=abc\n");
    process.env.WALKMYCODE_HOME = home;
  });
  after(() => {
    if (saved === undefined) delete process.env.WALKMYCODE_HOME;
    else process.env.WALKMYCODE_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });

  it("reads keys.env and key-named settings, longest first, and skips short values", () => {
    const got = knownSecrets({ MY_SERVICE_TOKEN: "hunter2hunter2hunter2", PATH: "/usr/bin:/bin:/usr/local/bin", PWD: "/home/someone/projects", OLDPWD: "/home/someone/older" });
    assert.deepEqual(got, ["hunter2hunter2hunter2", "plainwordsbutsecret"]);
  });
});
