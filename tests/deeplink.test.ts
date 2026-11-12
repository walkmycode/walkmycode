// Links into the Explore room: /map?focus=<path>[:<start>[-<end>]][#<symbol>]
// and /map?node=<id>. The parser, and where a link lands on a map.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeMap } from "../src/analyzer/types";
import { parseDeepLink, resolveDeepLink, withoutDeepLink } from "../src/shell/deeplink";

describe("parseDeepLink", () => {
  it("reads a path alone", () => {
    assert.deepEqual(parseDeepLink("?focus=src/app.ts"), { kind: "focus", path: "src/app.ts" });
  });
  it("reads one line and a range", () => {
    assert.deepEqual(parseDeepLink("?focus=src/app.ts:12"), { kind: "focus", path: "src/app.ts", start: 12, end: 12 });
    assert.deepEqual(parseDeepLink("?focus=src/app.ts:12-30"), { kind: "focus", path: "src/app.ts", start: 12, end: 30 });
  });
  it("swaps a backwards range and clamps line 0", () => {
    assert.deepEqual(parseDeepLink("?focus=a.py:30-12"), { kind: "focus", path: "a.py", start: 12, end: 30 });
    assert.deepEqual(parseDeepLink("?focus=a.py:0"), { kind: "focus", path: "a.py", start: 1, end: 1 });
  });
  it("takes #symbol from the URL fragment or from inside focus", () => {
    assert.deepEqual(parseDeepLink("?focus=src/api.ts", "#createOrder"), { kind: "focus", path: "src/api.ts", symbol: "createOrder" });
    assert.deepEqual(parseDeepLink("?focus=src%2Fapi.ts%23createOrder"), { kind: "focus", path: "src/api.ts", symbol: "createOrder" });
    assert.deepEqual(parseDeepLink("?focus=src/api.ts:5-9", "#createOrder"), { kind: "focus", path: "src/api.ts", start: 5, end: 9, symbol: "createOrder" });
  });
  it("strips a leading ./ or / and decodes the path", () => {
    assert.deepEqual(parseDeepLink("?focus=./src/a%20b.ts:3"), { kind: "focus", path: "src/a b.ts", start: 3, end: 3 });
    assert.deepEqual(parseDeepLink("focus=/src/a.ts"), { kind: "focus", path: "src/a.ts" });
  });
  it("reads ?node=, and focus wins over node", () => {
    assert.deepEqual(parseDeepLink("?node=route%3Aapi.ts%23GET%20%2Forders"), { kind: "node", id: "route:api.ts#GET /orders" });
    assert.equal(parseDeepLink("?focus=a.ts&node=x")?.kind, "focus");
  });
  it("is null when there is no link", () => {
    assert.equal(parseDeepLink(""), null);
    assert.equal(parseDeepLink("?focus="), null);
    assert.equal(parseDeepLink("?other=1", "#system"), null);
  });
});

const map = {
  files: [
    { path: "src/api.ts", lang: "ts", lines: 60, area: "shop", fns: { createOrder: [10, 20, []], helper: [30, 34, []] } },
    { path: "src/Page.tsx", lang: "tsx", lines: 40, area: "shop" },
  ],
  nodes: [
    { id: "file:src/api.ts", name: "api", kind: "module", layer: "logic", area: "shop", file: "src/api.ts", line: 1 },
    { id: "route:src/api.ts#POST /orders", name: "POST /orders", kind: "route", layer: "api", area: "shop", file: "src/api.ts", line: 5, endLine: 6, handler: "createOrder" },
    { id: "file:src/Page.tsx", name: "Checkout", kind: "component", layer: "ui", area: "shop", file: "src/Page.tsx", line: 3, endLine: 38 },
  ],
  services: [{ id: "svc-int:orders", name: "orders", kind: "app", areas: ["shop"], hostnames: [], entry: { file: "src/api.ts", line: 2, text: "node api.ts" } }],
  edges: [],
} as unknown as CodeMap;

describe("resolveDeepLink", () => {
  it("opens the lines and selects the card that owns them", () => {
    assert.deepEqual(resolveDeepLink(map, { kind: "focus", path: "src/api.ts", start: 12, end: 14 }), { path: "src/api.ts", start: 12, end: 14, nodeId: "route:src/api.ts#POST /orders" });
    assert.deepEqual(resolveDeepLink(map, { kind: "focus", path: "src/api.ts", start: 31, end: 31 }), { path: "src/api.ts", start: 31, end: 31, nodeId: "file:src/api.ts" });
  });
  it("finds #symbol in the file's functions", () => {
    assert.deepEqual(resolveDeepLink(map, { kind: "focus", path: "src/api.ts", symbol: "helper" }), { path: "src/api.ts", start: 30, end: 34, nodeId: "file:src/api.ts" });
    assert.deepEqual(resolveDeepLink(map, { kind: "focus", path: "src/api.ts", symbol: "createOrder" }), { path: "src/api.ts", start: 10, end: 20, nodeId: "route:src/api.ts#POST /orders" });
  });
  it("falls back to a card of that name, and explicit lines beat the symbol", () => {
    assert.deepEqual(resolveDeepLink(map, { kind: "focus", path: "src/Page.tsx", symbol: "Checkout" }), { path: "src/Page.tsx", start: 3, end: 38, nodeId: "file:src/Page.tsx" });
    assert.equal(resolveDeepLink(map, { kind: "focus", path: "src/api.ts", start: 31, end: 31, symbol: "createOrder" })?.start, 31);
  });
  it("opens a file with no lines at its top, owned by its file card", () => {
    assert.deepEqual(resolveDeepLink(map, { kind: "focus", path: "src/Page.tsx" }), { path: "src/Page.tsx", start: undefined, end: undefined, nodeId: "file:src/Page.tsx" });
  });
  it("resolves ?node= to a node or a service", () => {
    assert.deepEqual(resolveDeepLink(map, { kind: "node", id: "route:src/api.ts#POST /orders" }), { path: "src/api.ts", start: 5, end: 6, nodeId: "route:src/api.ts#POST /orders" });
    assert.deepEqual(resolveDeepLink(map, { kind: "node", id: "svc-int:orders" }), { path: "src/api.ts", start: 2, end: 2, nodeId: "svc-int:orders" });
  });
  it("is null for a file or node not in the map", () => {
    assert.equal(resolveDeepLink(map, { kind: "focus", path: "nope.ts" }), null);
    assert.equal(resolveDeepLink(map, { kind: "node", id: "nope" }), null);
  });
});

describe("withoutDeepLink", () => {
  it("removes the link and its symbol fragment, keeping other parameters", () => {
    assert.equal(withoutDeepLink("http://x/map?focus=a.ts%3A3&keep=1#sym"), "/map?keep=1");
    assert.equal(withoutDeepLink("http://x/map?node=n#system"), "/map#system");
  });
});
