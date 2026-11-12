// The loopback + same-origin guard: what a browser on this machine sends
// passes, what a curl on this machine sends passes, and anything else
// (another host on the LAN, a foreign page in the same browser) gets 403.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { checkLocalSameOrigin, ForbiddenError, guarded, HttpError } from "../src/lib/providers/guard";

function req(headers: Record<string, string>, method = "GET"): Request {
  return new Request("http://localhost:3000/api/config", { method, headers, ...(method === "GET" ? {} : { body: "{}" }) });
}

describe("checkLocalSameOrigin", () => {
  after(() => {
    delete process.env.WALKMYCODE_ALLOW_REMOTE;
    delete process.env.SITE_URL;
  });

  it("accepts the three loopback hosts on any port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST:8080"]) {
      assert.equal(checkLocalSameOrigin(req({ host })), null, host);
    }
  });

  it("refuses any other host", () => {
    for (const host of ["192.168.1.5:3000", "walkmycode.local:3000", "example.com", "localhost.evil.com:3000", ""]) {
      assert.equal(checkLocalSameOrigin(req({ host }))?.code, "forbidden", host || "(empty)");
    }
  });

  it("accepts Sec-Fetch-Site same-origin and none, refuses the rest", () => {
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "same-origin" })), null);
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "none" })), null);
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "cross-site" }))?.code, "forbidden");
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "same-site" }))?.code, "forbidden");
  });

  it("refuses a cross-site request even when its Origin claims to match", () => {
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "sec-fetch-site": "cross-site", origin: "http://localhost:3000" }))?.code, "forbidden");
  });

  it("passes a curl-style request with no fetch metadata and no Origin", () => {
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000" })), null);
    assert.equal(checkLocalSameOrigin(req({ host: "127.0.0.1:3000", "content-type": "application/json" }, "POST")), null);
  });

  it("falls back to comparing Origin with Host when Sec-Fetch-Site is absent", () => {
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000" })), null);
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", origin: "https://evil.example" }))?.code, "forbidden");
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3001" }))?.code, "forbidden");
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", origin: "null" }))?.code, "forbidden");
  });

  it("requires application/json on writes", () => {
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000" }, "POST"))?.code, "forbidden");
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" }, "POST"))?.code, "forbidden");
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "content-type": "text/plain" }, "DELETE"))?.code, "forbidden");
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "content-type": "application/json" }, "POST")), null);
    assert.equal(checkLocalSameOrigin(req({ host: "localhost:3000", "content-type": "application/json; charset=utf-8" }, "DELETE")), null);
  });

  it("lets WALKMYCODE_ALLOW_REMOTE=1 relax the host check but not the origin check", () => {
    process.env.WALKMYCODE_ALLOW_REMOTE = "1";
    assert.equal(checkLocalSameOrigin(req({ host: "192.168.1.5:3000" })), null);
    assert.equal(checkLocalSameOrigin(req({ host: "192.168.1.5:3000", origin: "http://192.168.1.5:3000" })), null);
    assert.equal(checkLocalSameOrigin(req({ host: "192.168.1.5:3000", origin: "https://evil.example" }))?.code, "forbidden");
    delete process.env.WALKMYCODE_ALLOW_REMOTE;
    assert.equal(checkLocalSameOrigin(req({ host: "192.168.1.5:3000" }))?.code, "forbidden");
  });

  it("writes the spec's 403 copy", () => {
    const fe = checkLocalSameOrigin(req({ host: "example.com:3000" }));
    assert.deepEqual(fe, {
      code: "forbidden",
      title: "Settings can only be changed from this computer",
      message: "Open WalkMyCode at http://localhost:3000 to change keys or ask questions.",
      action: null,
    });
  });

  it("names the address WalkMyCode is really on, from the Host or SITE_URL", () => {
    const at = (headers: Record<string, string>) => checkLocalSameOrigin(req(headers))?.message.replace(/^Open WalkMyCode at (\S+) .*$/, "$1");
    // A foreign page on a loopback host: send them to that same host and port.
    assert.equal(at({ host: "127.0.0.1:4000", origin: "https://evil.example" }), "http://127.0.0.1:4000");
    assert.equal(at({ host: "[::1]:3001", "sec-fetch-site": "cross-site" }), "http://[::1]:3001");
    // Another machine on the LAN: localhost on the port it used, never the LAN address.
    assert.equal(at({ host: "192.168.1.5:3005" }), "http://localhost:3005");
    assert.equal(at({ host: "walkmycode.local" }), "http://localhost");
    assert.equal(at({ host: "evil.example:80/phish" }), "http://localhost", "only a numeric port is carried over");
    // Under WALKMYCODE_ALLOW_REMOTE the LAN address is legitimate.
    process.env.WALKMYCODE_ALLOW_REMOTE = "1";
    assert.equal(at({ host: "192.168.1.5:3005", origin: "https://evil.example" }), "http://192.168.1.5:3005");
    delete process.env.WALKMYCODE_ALLOW_REMOTE;
    // SITE_URL wins when set.
    process.env.SITE_URL = "https://walkmycode.example.com/app";
    assert.equal(at({ host: "192.168.1.5:3005" }), "https://walkmycode.example.com");
    delete process.env.SITE_URL;
  });
});

describe("guarded", () => {
  it("answers 403 with { error } before the handler runs", async () => {
    let ran = false;
    const handler = guarded(async () => {
      ran = true;
      return Response.json({ ok: true });
    });
    const res = await handler(req({ host: "localhost:3000", origin: "https://evil.example" }));
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "forbidden");
    assert.equal(ran, false);
  });

  it("runs the handler for a local request and maps HttpError to its status", async () => {
    const ok = await guarded(async () => Response.json({ ok: true }))(req({ host: "localhost:3000" }));
    assert.equal(ok.status, 200);
    const bad = await guarded(async () => {
      throw new HttpError(400, "Unknown provider: nope");
    })(req({ host: "localhost:3000" }));
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "Unknown provider: nope" });
  });

  it("turns a JSON parse failure into 400 and anything else into a 500 that keeps the message to itself", async () => {
    const parse = await guarded(async (r) => Response.json(await r.json()))(new Request("http://localhost:3000/api/config", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: "{not json" }));
    assert.equal(parse.status, 400);
    const orig = console.error;
    console.error = () => {};
    try {
      const boom = await guarded(async () => {
        throw new Error("secret sk-ant-api03-abcdefghijklmnop leaked");
      })(req({ host: "localhost:3000" }));
      assert.equal(boom.status, 500);
      assert.ok(!JSON.stringify(await boom.json()).includes("sk-ant"));
    } finally {
      console.error = orig;
    }
  });

  it("exposes ForbiddenError for callers that guard by hand", () => {
    assert.ok(new ForbiddenError({ code: "forbidden", title: "t", message: "m", action: null }) instanceof Error);
  });
});
