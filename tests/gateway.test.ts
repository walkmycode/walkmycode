// Rewrite and proxy readers (SERVICES.md §3, §9 task 6): next.config
// rewrites, Vite server.proxy, the CRA "proxy" field, Angular proxy.conf.json,
// nginx location/proxy_pass, Kubernetes Ingress and Gateway API HTTPRoute.
// Every rule cites its line; only literal rules are kept.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractGateways, matchGateway, readAngularProxy, readK8sRoutes, readNginx, readPackageProxy, sourceSegments } from "../src/analyzer/config/gateway";
import type { GatewayRule } from "../src/analyzer/types";
import "./analyzer.helpers"; // grammars from node_modules

const brief = (r: GatewayRule) => ({ source: r.source.join("/"), toHost: r.toHost, strip: r.strip, prepend: r.prependPath.join("/"), line: r.evidence.line, confidence: r.confidence });

describe("paths", () => {
  it("reads path-to-regexp style sources", () => {
    assert.deepEqual(sourceSegments("/api/:path*"), ["api", "**"]);
    assert.deepEqual(sourceSegments("/u/:id"), ["u", "*"]);
    assert.deepEqual(sourceSegments("/"), ["**"]);
    assert.equal(sourceSegments("/api/(v1|v2)/x"), null, "a regex group is not literal");
  });

  it("matches and rewrites a call's segments", () => {
    const rule = { source: ["api", "**"], strip: 1, prependPath: ["v1"] } as unknown as GatewayRule;
    assert.deepEqual(matchGateway(rule, ["api", "users", "*"]), ["v1", "users", "*"]);
    assert.equal(matchGateway(rule, ["health"]), null);
    assert.equal(matchGateway(rule, ["*", "users"]), null, "a runtime segment never matches a literal prefix");
    const exact = { source: ["u", "*"], strip: 1, prependPath: ["users"] } as unknown as GatewayRule;
    assert.deepEqual(matchGateway(exact, ["u", "7"]), ["users", "7"]);
    assert.equal(matchGateway(exact, ["u", "7", "x"]), null);
  });
});

describe("next.config rewrites", () => {
  it("reads the array form and the beforeFiles/afterFiles/fallback form, and the env block", async () => {
    const content = [
      "module.exports = {", // 1
      '  env: { API_BASE: "http://users:8080" },', // 2
      "  async redirects() {", // 3
      '    return [{ source: "/old", destination: "/new", permanent: true }];', // 4
      "  },", // 5
      "  async rewrites() {", // 6
      "    return {", // 7
      '      beforeFiles: [{ source: "/api/:path*", destination: "http://users:8080/:path*" }],', // 8
      '      afterFiles: [{ source: "/docs/:slug", destination: "/documentation/:slug", has: [{ type: "query", key: "v" }] }],', // 9
      "      fallback: [", // 10
      '        { source: "/:path*", destination: "https://old.example.com/:path*" },', // 11
      '        { source: "/legacy/:path*", destination: "http://legacy:9000/v1/:path*" },', // 12
      "      ],", // 13
      "    };", // 14
      "  },", // 15
      "};", // 16
    ].join("\n");
    const r = await extractGateways([{ path: "web/next.config.js", content }]);
    assert.deepEqual(r.rules.map(brief), [
      { source: "api/**", toHost: "users:8080", strip: 1, prepend: "", line: 8, confidence: "certain" },
      { source: "docs/*", toHost: undefined, strip: 1, prepend: "documentation", line: 9, confidence: "likely" },
      { source: "legacy/**", toHost: "legacy:9000", strip: 1, prepend: "v1", line: 12, confidence: "likely" },
    ]);
    assert.ok(r.rules.every((x) => x.kind === "next-rewrite" && x.evidence.role === "config" && x.evidence.file === "web/next.config.js"));
    assert.deepEqual(r.envValues, [{ name: "API_BASE", value: "http://users:8080", file: "web/next.config.js", line: 2 }]);
  });
});

describe("dev-server proxies", () => {
  it("vite: a string target, and a rewrite that strips the prefix for sure", async () => {
    const content = [
      'import { defineConfig } from "vite";', // 1
      "export default defineConfig({", // 2
      "  server: {", // 3
      "    proxy: {", // 4
      '      "/api": { target: "http://localhost:8000", rewrite: (path) => path.replace(/^\\/api/, "") },', // 5
      '      "/ws": { target: "ws://localhost:8000", ws: true, rewrite: (p) => p.slice(3) },', // 6
      '      "/auth": "http://auth:4000",', // 7
      '      "^/fallback/.*": "http://other:1",', // 8
      "    },", // 9
      "  },", // 10
      "});", // 11
    ].join("\n");
    const r = await extractGateways([{ path: "web/vite.config.ts", content }]);
    assert.deepEqual(r.rules.map(brief), [
      { source: "api/**", toHost: "localhost:8000", strip: 1, prepend: "", line: 5, confidence: "certain" },
      { source: "ws/**", toHost: "localhost:8000", strip: 1, prepend: "", line: 6, confidence: "likely" },
      { source: "auth/**", toHost: "auth:4000", strip: 0, prepend: "", line: 7, confidence: "certain" },
    ]);
  });

  it("create-react-app: package.json proxy sends everything it has no file for", () => {
    const r = readPackageProxy("web/package.json", '{\n  "name": "web",\n  "proxy": "http://api:5000"\n}\n');
    assert.deepEqual(r.rules.map(brief), [{ source: "**", toHost: "api:5000", strip: 0, prepend: "", line: 3, confidence: "certain" }]);
    assert.deepEqual(readPackageProxy("x/package.json", '{"name":"x"}').rules, []);
  });

  it("angular: proxy.conf.json with and without a pathRewrite", () => {
    const r = readAngularProxy("web/proxy.conf.json", '{\n  "/api": { "target": "http://api:3000", "pathRewrite": { "^/api": "" } },\n  "/img/*": { "target": "http://cdn:80" }\n}\n');
    assert.deepEqual(r.rules.map(brief), [
      { source: "api/**", toHost: "api:3000", strip: 1, prepend: "", line: 2, confidence: "certain" },
      { source: "img/**", toHost: "cdn:80", strip: 0, prepend: "", line: 3, confidence: "certain" },
    ]);
  });
});

describe("nginx", () => {
  it("reads upstreams, set variables, prefix and exact locations; skips regex ones", () => {
    const content = [
      "upstream users_up {", // 1
      "  server users:8080 weight=2;", // 2
      "}", // 3
      "server {", // 4
      "  listen 80;", // 5
      "  location /api/ {", // 6
      "    proxy_pass http://users_up/; # strips /api/", // 7
      "  }", // 8
      "  location = /health { proxy_pass http://orders:8000; }", // 9
      "  location ~ \\.php$ { proxy_pass http://php:9000; }", // 10
      "  location / {", // 11
      "    set $app http://web:3000;", // 12
      "    proxy_pass $app;", // 13
      "  }", // 14
      "}", // 15
    ].join("\n");
    const r = readNginx("deploy/nginx.conf", content);
    assert.deepEqual(r.rules.map(brief), [
      { source: "api/**", toHost: "users:8080", strip: 1, prepend: "", line: 7, confidence: "certain" },
      { source: "health", toHost: "orders:8000", strip: 0, prepend: "", line: 9, confidence: "certain" },
      { source: "**", toHost: "web:3000", strip: 0, prepend: "", line: 13, confidence: "certain" },
    ]);
  });
});

describe("Kubernetes", () => {
  it("Ingress paths and HTTPRoute matches (with a prefix rewrite) become rules", () => {
    const content = [
      "apiVersion: networking.k8s.io/v1", // 1
      "kind: Ingress", // 2
      "metadata:", // 3
      "  name: shop", // 4
      "spec:", // 5
      "  rules:", // 6
      "    - http:", // 7
      "        paths:", // 8
      "          - path: /api", // 9
      "            pathType: Prefix", // 10
      "            backend:", // 11
      "              service:", // 12
      "                name: users", // 13
      "                port:", // 14
      "                  number: 8080", // 15
      "---", // 16
      "apiVersion: gateway.networking.k8s.io/v1", // 17
      "kind: HTTPRoute", // 18
      "metadata:", // 19
      "  name: orders", // 20
      "spec:", // 21
      "  rules:", // 22
      "    - matches:", // 23
      "        - path:", // 24
      "            type: PathPrefix", // 25
      "            value: /shop/orders", // 26
      "      filters:", // 27
      "        - type: URLRewrite", // 28
      "          urlRewrite:", // 29
      "            path:", // 30
      "              type: ReplacePrefixMatch", // 31
      "              replacePrefixMatch: /orders", // 32
      "      backendRefs:", // 33
      "        - name: orders", // 34
      "          port: 8000", // 35
    ].join("\n");
    const r = readK8sRoutes("k8s/routes.yaml", content);
    assert.deepEqual(r.rules.map((x) => [x.kind, ...Object.values(brief(x))]), [
      ["ingress", "api/**", "users:8080", 0, "", 9, "certain"],
      ["httproute", "shop/orders/**", "orders:8000", 2, "orders", 24, "certain"],
    ]);
  });

  it("skips Helm templates", () => {
    assert.deepEqual(readK8sRoutes("chart/templates/ing.yaml", "kind: Ingress\nspec:\n  rules: {{ .Values.rules }}\n").rules, []);
  });
});
