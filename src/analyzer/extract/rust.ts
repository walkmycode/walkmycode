// Facts from a Rust file: modules (`mod x;`) and `use` paths, functions and
// `impl` methods, axum routers (`.route("/x", get(h).post(h2))`, `.nest`,
// `.merge`), actix-web and Rocket route attributes (`#[get("/x")]`), SQL in
// strings (sqlx, rusqlite, diesel's sql_query), reqwest calls, env reads.
//
// A `use` becomes one import per name, its spec the full path as written
// ("crate::db::User", "super::payments", "gateway::Gateway"); build.ts walks
// the module tree to the file (resolveRust). A `mod x;` is an import of
// "self::x" that binds `x`, so `x::f()` calls are followed like any other.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type FileFacts, type FnFact, type HttpCallFact, type Method } from "../facts";
import { serviceFacts, serviceForPackage, sqlColumns, sqlInString } from "./common";

/** axum's method routers: `get(h)`, `routing::post(h)`, `get(h).post(h2)`, `any(h)`. */
const AXUM_METHODS: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", any: "ANY", head: "GET", options: "ANY" };
/** actix-web and Rocket: `#[get("/x")]` on the handler. */
const ATTR_METHODS: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", head: "GET", options: "ANY", route: "ANY" };
const HTTP_VERBS: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", head: "GET" };
/** A receiver that is an HTTP client: reqwest's Client, a `client`/`http` binding, surf, ureq. */
const HTTP_RECEIVER = /(^|[.:])(reqwest|client|http|http_client|ureq|surf|agent)$|Client::new\(\)$|Client::builder\(\)/i;
const ENV_CALL = /^(?:std::)?env::var(?:_os)?$|^dotenvy?::var$|^var$/;

const line = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;

/** A string literal's text without its quotes (raw strings too); escapes kept as written. */
function strOf(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "string_literal") return n.text.replace(/^b?"/, "").replace(/"$/, "");
  if (n.type === "raw_string_literal") return n.text.replace(/^b?r(#*)"/, "").replace(/"#*$/, "");
  return null;
}

/** The path a call names, with `::` as `.`: `db::all_users` → "db.all_users", `x.send` → "x.send". */
function calleeOf(fn: Node | null): string | null {
  if (!fn) return null;
  if (fn.type === "generic_function") return calleeOf(fn.childForFieldName("function"));
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "scoped_identifier") {
    const t = fn.text.replace(/<[^>]*>/g, "").replace(/^(crate|self|super)::/, "");
    return /^[\w:]+$/.test(t) ? t.replace(/::/g, ".") : null;
  }
  if (fn.type === "field_expression") {
    const v = fn.childForFieldName("value");
    const f = fn.childForFieldName("field");
    if (v && f && (v.type === "identifier" || v.type === "self")) return `${v.text}.${f.text}`;
  }
  return null;
}

function callsIn(body: Node | null): string[] {
  if (!body) return [];
  const out = new Set<string>();
  for (const c of body.descendantsOfType("call_expression")) {
    // A module is only ever reached through `::`: `x.f()` is a method on a value, even when a module is called x.
    const fn = c?.childForFieldName("function");
    if (!fn || fn.type === "field_expression") continue;
    const name = calleeOf(fn);
    if (name) out.add(name);
  }
  return [...out];
}

const isPub = (n: Node) => n.namedChildren.some((c) => c?.type === "visibility_modifier");

/** Every leaf of a `use` tree as (path, local name): `a::{b, c::D as E, self}` → a::b b, a::c::D E, a self. */
function leavesOfUse(n: Node | null, prefix: string, out: { path: string; local: string; imported: string }[]) {
  if (!n) return;
  const join = (a: string, b: string) => (a ? `${a}::${b}` : b);
  switch (n.type) {
    case "identifier":
    case "crate":
    case "super": {
      const path = join(prefix, n.text);
      out.push({ path, local: n.text, imported: n.text });
      return;
    }
    case "self": {
      // `use a::{self}` names the module a itself.
      const name = prefix.split("::").pop() ?? "";
      if (prefix) out.push({ path: prefix, local: name, imported: name });
      return;
    }
    case "scoped_identifier": {
      const path = join(prefix, n.text);
      const name = n.childForFieldName("name")?.text ?? path.split("::").pop()!;
      out.push({ path, local: name, imported: name });
      return;
    }
    case "use_as_clause": {
      const p = n.childForFieldName("path");
      const alias = n.childForFieldName("alias")?.text;
      if (!p || !alias) return;
      const path = join(prefix, p.text);
      out.push({ path, local: alias, imported: path.split("::").pop()! });
      return;
    }
    case "use_wildcard": {
      const p = n.namedChildren[0];
      if (p) out.push({ path: join(prefix, p.text), local: "*", imported: "*" });
      return;
    }
    case "scoped_use_list": {
      const p = n.childForFieldName("path");
      const next = p ? join(prefix, p.text) : prefix;
      leavesOfUse(n.childForFieldName("list"), next, out);
      return;
    }
    case "use_list":
      for (const c of n.namedChildren) leavesOfUse(c, prefix, out);
      return;
  }
}

/** A URL argument: a literal, a `format!("{}/x", BASE)`, `&url` of either. `*` for each `{}`. */
function urlArg(n: Node | null | undefined, consts: FileFacts["consts"]): Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent"> | null {
  if (!n) return null;
  if (n.type === "reference_expression") return urlArg(n.namedChildren[n.namedChildren.length - 1], consts);
  const s = strOf(n);
  if (s !== null) return { url: s, fromVariable: false };
  if (n.type === "macro_invocation" && /^format$/.test(n.childForFieldName("macro")?.text ?? "")) {
    const tt = n.namedChildren.find((c) => c?.type === "token_tree");
    const fmt = tt?.namedChildren.find((c) => c?.type === "string_literal");
    const text = strOf(fmt);
    if (text === null || !tt) return null;
    const args = tt.namedChildren.filter((c) => c && c !== fmt && c.type === "identifier").map((c) => c!.text);
    // `{}` takes the next argument; `{BASE}` names it.
    const firstHole = /^\{(\w*)(?::[^}]*)?\}/.exec(text);
    const lead = firstHole ? firstHole[1] || args[0] : undefined;
    const url = text.replace(/\{\w*(?::[^}]*)?\}/g, "*");
    if (lead && consts[lead]) {
      const c = consts[lead];
      return { url, fromVariable: true, ...(c.envVar ? { varName: c.envVar } : {}), ...(c.literal ? { literalBase: c.literal } : {}) };
    }
    return { url, fromVariable: !!firstHole, ...(lead && /^[A-Z_][A-Z0-9_]*$/.test(lead) ? { baseIdent: lead } : {}) };
  }
  if (n.type === "identifier" && consts[n.text]?.literal) return { url: consts[n.text].literal!, fromVariable: false };
  return null;
}

/** The (method, handler) pairs of an axum method router: `get(a).post(b)`, `routing::get(a)`, `get(a).layer(..)`. */
function methodRouter(n: Node | null, out: { method: Method; handler?: string }[]) {
  if (!n || n.type !== "call_expression") return;
  const fn = n.childForFieldName("function");
  const arg0 = n.childForFieldName("arguments")?.namedChildren[0];
  const handler = arg0 ? (calleeOf(arg0) ?? undefined) : undefined;
  if (!fn) return;
  if (fn.type === "identifier" || fn.type === "scoped_identifier") {
    const name = fn.type === "identifier" ? fn.text : (fn.childForFieldName("name")?.text ?? "");
    const m = AXUM_METHODS[name];
    if (m) out.push({ method: m, handler });
    return;
  }
  if (fn.type === "field_expression") {
    // `get(a).post(b)`: the inner call first, so the routes keep the order they are written in.
    methodRouter(fn.childForFieldName("value"), out);
    const field = fn.childForFieldName("field")?.text ?? "";
    const m = AXUM_METHODS[field];
    if (m) out.push({ method: m, handler });
  }
}

export function extractRust(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);

  // ── module constants: `const BASE: &str = "https://…"`, `static URL: &str = …` ──
  for (const c of root.namedChildren) {
    if (!c || (c.type !== "const_item" && c.type !== "static_item")) continue;
    const name = c.childForFieldName("name")?.text;
    const v = strOf(c.childForFieldName("value"));
    if (name && v !== null) f.consts[name] = { literal: v, line: line(c) };
    if (name && isPub(c)) f.exports.push(name);
  }

  // ── modules and uses (at any depth: inline `mod x { use … }` too) ──
  for (const m of root.descendantsOfType("mod_item")) {
    if (!m) continue;
    const name = m.childForFieldName("name")?.text;
    if (!name) continue;
    if (isPub(m)) f.exports.push(name);
    // `mod x;` names a file; `mod tests { … }` is inline (its uses are read below).
    if (!m.childForFieldName("body")) f.imports.push({ spec: `self::${name}`, names: [{ local: name, imported: "*" }], line: line(m) });
  }
  for (const u of root.descendantsOfType("use_declaration")) {
    if (!u) continue;
    // A `use` inside `#[cfg(test)] mod tests` is the tests' own business.
    if (insideTestMod(u)) continue;
    const leaves: { path: string; local: string; imported: string }[] = [];
    leavesOfUse(u.childForFieldName("argument"), "", leaves);
    for (const l of leaves) {
      f.imports.push({ spec: l.path, names: [{ local: l.local, imported: l.imported }], line: line(u) });
      const crate = l.path.split("::")[0];
      if (!["crate", "self", "super", "std", "core", "alloc"].includes(crate)) {
        const svc = serviceForPackage(crate.replace(/_/g, "-")) ?? serviceForPackage(crate);
        if (svc) f.services.push({ service: svc, line: line(u), via: "sdk", text: u.text.slice(0, 120) });
      }
    }
  }

  // ── functions, `impl` methods, and the items a file makes public ──
  const fnOf = (fnNode: Node, prefix: string): FnFact | null => {
    const name = fnNode.childForFieldName("name")?.text;
    if (!name) return null;
    return { name: prefix ? `${prefix}::${name}` : name, start: line(fnNode), end: endLine(fnNode), calls: callsIn(fnNode.childForFieldName("body")), exported: isPub(fnNode) };
  };
  const walkItems = (scope: Node, prefix: string) => {
    for (const c of scope.namedChildren) {
      if (!c) continue;
      if (c.type === "function_item") {
        const fn = fnOf(c, prefix);
        if (fn) {
          f.fns.push(fn);
          if (fn.exported && !prefix) f.exports.push(fn.name);
        }
      } else if (c.type === "impl_item" || c.type === "trait_item") {
        const ty = (c.childForFieldName("type") ?? c.childForFieldName("name"))?.text.replace(/<[\s\S]*$/, "") ?? "";
        const body = c.childForFieldName("body");
        if (body) walkItems(body, ty);
        if (c.type === "trait_item" && isPub(c) && ty) f.exports.push(ty);
      } else if (["struct_item", "enum_item", "type_item", "union_item"].includes(c.type)) {
        const name = c.childForFieldName("name")?.text;
        if (name && isPub(c)) f.exports.push(name);
      } else if (c.type === "mod_item" && !isTestMod(c)) {
        const body = c.childForFieldName("body");
        if (body) walkItems(body, c.childForFieldName("name")?.text ?? prefix);
      }
    }
  };
  walkItems(root, "");
  // A handler can sit anywhere; the route looks it up by name.
  f.nested = f.fns.map((x) => ({ name: x.name.split("::").pop()!, start: x.start, end: x.end }));

  // ── routes: axum `.route(path, method_router)`, `.nest(prefix, router)`, `.merge(router)` ──
  for (const call of root.descendantsOfType("call_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    if (fn?.type !== "field_expression") continue;
    const field = fn.childForFieldName("field")?.text;
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    const owner = enclosingFn(call);
    // A chain's calls all start where the chain starts: the line is `.route`'s own.
    const at = (fn.childForFieldName("field") ?? call).startPosition.row + 1;
    if (field === "route" && args.length >= 2) {
      const path = strOf(args[0]);
      if (path === null) continue;
      const pairs: { method: Method; handler?: string }[] = [];
      methodRouter(args[1], pairs);
      for (const p of pairs) f.routes.push({ method: p.method, path, line: at, endLine: at, handler: p.handler, ...(owner ? { owner } : {}) });
    } else if ((field === "nest" || field === "nest_service") && args.length >= 2) {
      const prefix = strOf(args[0]);
      const target = routerTarget(args[1]);
      if (prefix !== null && target) f.includes.push({ target, prefix, line: at });
    } else if (field === "merge" && args.length >= 1) {
      const target = routerTarget(args[0]);
      if (target) f.includes.push({ target, prefix: "", line: at });
    }
  }

  // ── routes: actix-web / Rocket attributes on the handler, `#[get("/users/{id}")]` ──
  for (const fnNode of root.descendantsOfType("function_item")) {
    if (!fnNode) continue;
    for (let a = fnNode.previousNamedSibling; a && a.type === "attribute_item"; a = a.previousNamedSibling) {
      const attr = a.namedChildren[0];
      const name = attr?.namedChildren[0]?.text.split("::").pop() ?? "";
      const m = ATTR_METHODS[name];
      if (!m) continue;
      const tt = attr?.childForFieldName("arguments");
      const path = strOf(tt?.namedChildren.find((c) => c?.type === "string_literal"));
      if (path === null || path === undefined) continue;
      // `#[route("/x", method = "GET")]`
      const method = name === "route" ? ((/method\s*=\s*"(\w+)"/.exec(tt?.text ?? "")?.[1]?.toUpperCase() as Method | undefined) ?? "ANY") : m;
      f.routes.push({ method, path, line: line(a), endLine: endLine(fnNode), handler: fnNode.childForFieldName("name")?.text });
    }
  }

  f.routes.sort((a, b) => a.line - b.line);
  f.includes.sort((a, b) => a.line - b.line);

  // ── calls: HTTP clients and env reads ──
  // In a file that uses an HTTP client crate, `x.post(url)` on any receiver counts when the argument is a URL.
  const httpCrate = /\b(reqwest|ureq|surf|isahc|hyper)\b/.test(src);
  const urlish = (u: { url: string; literalBase?: string; varName?: string }) => /^(https?:\/\/|wss?:\/\/|\/|\*\/)/.test(u.url) && (!u.url.startsWith("*") || !!u.literalBase || !!u.varName);
  for (const call of root.descendantsOfType("call_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    const text = fn?.text ?? "";
    if (fn && ENV_CALL.test(text.replace(/\s/g, ""))) {
      const name = strOf(args[0]);
      if (name) {
        f.envReads.push({ name, line: line(call) });
        f.services.push(...serviceFacts(name, line(call), "env"));
      }
      continue;
    }
    // reqwest::get(url), client.post(url), Client::new().get(url)
    let method: Method | undefined;
    let callee = "";
    if (fn?.type === "scoped_identifier" && /^reqwest::(blocking::)?get$/.test(text)) {
      method = "GET";
      callee = text;
    } else if (fn?.type === "field_expression") {
      const verb = fn.childForFieldName("field")?.text ?? "";
      const recv = fn.childForFieldName("value")?.text.replace(/\s+/g, "") ?? "";
      if (HTTP_VERBS[verb] && (HTTP_RECEIVER.test(recv) || httpCrate)) {
        method = HTTP_VERBS[verb];
        callee = `${recv.split(".").pop()}.${verb}`;
      }
    }
    if (!method) continue;
    const u = urlArg(args[0], f.consts);
    if (u && (HTTP_RECEIVER.test(callee.split(".")[0]) || callee.startsWith("reqwest") || urlish(u))) f.http.push({ ...u, method, line: line(call), callee });
  }
  for (const mac of root.descendantsOfType("macro_invocation")) {
    if (!mac) continue;
    const name = mac.childForFieldName("macro")?.text;
    if (name !== "env" && name !== "option_env") continue;
    const tt = mac.namedChildren.find((c) => c?.type === "token_tree");
    const v = strOf(tt?.namedChildren.find((c) => c?.type === "string_literal"));
    if (v) f.envReads.push({ name: v, line: line(mac) });
  }
  // A constant read from the environment: `static BASE: Lazy<String> = Lazy::new(|| env::var("X")…)`.
  for (const c of root.namedChildren) {
    if (!c || (c.type !== "const_item" && c.type !== "static_item")) continue;
    const name = c.childForFieldName("name")?.text;
    const read = f.envReads.find((r) => r.line >= line(c) && r.line <= endLine(c));
    if (name && read) f.consts[name] = { ...(f.consts[name] ?? { line: line(c) }), envVar: read.name };
  }

  // ── strings: SQL (sqlx, rusqlite, diesel's sql_query) and hosts ──
  const seen = new Set<string>();
  for (const s of [...root.descendantsOfType("string_literal"), ...root.descendantsOfType("raw_string_literal")]) {
    if (!s) continue;
    const text = strOf(s);
    if (!text) continue;
    const startLine = line(s);
    const lineOf = (off: number) => startLine + (text.slice(0, off).match(/\n/g)?.length ?? 0);
    for (const q of sqlInString(text, lineOf)) {
      const k = `${q.table}|${q.op}|${q.line}`;
      if (!seen.has(k)) {
        seen.add(k);
        f.sql.push(q);
      }
    }
    for (const cols of sqlColumns(text, lineOf)) (f.columns ??= []).push(cols);
    for (const sv of serviceFacts(text, startLine, "host")) f.services.push(sv);
  }

  return f;
}

/** What `.nest`/`.merge` mounts: `routes::api()` → "routes.api", `users::router()` → "users.router", a variable by name. */
function routerTarget(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "call_expression") return calleeOf(n.childForFieldName("function"));
  if (n.type === "identifier") return n.text;
  return null;
}

/** The function a call sits in: an axum router built in `fn router()` is owned by "router". */
function enclosingFn(n: Node): string | undefined {
  for (let p = n.parent; p; p = p.parent) if (p.type === "function_item") return p.childForFieldName("name")?.text;
  return undefined;
}

function isTestMod(m: Node): boolean {
  if (m.childForFieldName("name")?.text === "tests") return true;
  for (let a = m.previousNamedSibling; a && a.type === "attribute_item"; a = a.previousNamedSibling) if (/cfg\s*\(\s*test\s*\)/.test(a.text)) return true;
  return false;
}
function insideTestMod(n: Node): boolean {
  for (let p = n.parent; p; p = p.parent) if (p.type === "mod_item" && isTestMod(p)) return true;
  return false;
}
