// Facts from a Kotlin file: its package, imports and the names it uses, classes, objects and
// functions, Spring MVC routes (`@GetMapping("/x")` under the class's `@RequestMapping`), Ktor
// routes (`get("/x") { }` inside `routing`/`route("/api")` or a `fun Route.x()`), JPA entities and
// Spring Data repositories, HTTP calls (RestTemplate, WebClient, OkHttp, Ktor's client), settings
// (`System.getenv`, `@Value("\${users.url}")`), SQL in strings.
//
// Kotlin and Java share one world of names: a Kotlin file imports a Java class by its full name and
// the other way round, so build.ts (resolveTyped) keeps both in one index. Unlike Java, a file may
// declare functions on their own: they are listed with its types, so `import shop.util.parseMoney`
// and a call from the same package find them. A method is "Class.method" (an object's and a
// companion's too); a call on a property, parameter or local with a declared type, or one made
// with `Type(…)`, is kept by that type, as in extract/java.ts.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type EntityFacts, type FileFacts, type HttpCallFact, type Method, type TypedFacts } from "../facts";
import { serviceFacts, sqlColumns, sqlInString } from "./common";
import { builderVerb, MAPPING, onBase, RELATION, REPOSITORY, REST_TEMPLATE, snake, valueSetting, webClientVerb } from "./java";

/** Ktor's verbs, as routes (`get("/x") { }`) and as its client's requests (`client.get("…")`). */
const KTOR: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", head: "GET" };
type Url = Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent">;

const line = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;
const kids = (n: Node | null | undefined, type: string) => (n?.namedChildren ?? []).filter((c): c is Node => c?.type === type);
const kid = (n: Node | null | undefined, type: string) => kids(n, type)[0] ?? null;

/** A string literal as written, without its quotes: `$id` and `${x.y}` still in it. Null for anything else. */
function rawString(n: Node | null | undefined): string | null {
  if (n?.type !== "string_literal") return null;
  return n.text.replace(/^"""|"""$/g, "").replace(/^"|"$/g, "");
}
/** A string's text when it is only text (`\$` is a dollar): an annotation's argument, a setting's name. */
function strOf(n: Node | null | undefined): string | null {
  const raw = rawString(n);
  return raw === null ? null : raw.replace(/\\\$/g, "$");
}

/** The simple name of a type: `List<Order>` → "List", `shop.data.Order?` → "Order". */
function typeName(t: Node | null | undefined): string | null {
  if (!t) return null;
  if (t.type === "nullable_type") return typeName(t.namedChildren[0]);
  if (t.type === "user_type") return kids(t, "identifier").pop()?.text ?? null;
  return null;
}
/** The type among a declaration's children (a parameter's, a property's). */
const typeIn = (n: Node | null | undefined) => (n?.namedChildren ?? []).find((c) => c?.type === "user_type" || c?.type === "nullable_type") ?? null;

interface Ann {
  first: string | null;
  named: Record<string, Node>;
}
/** One annotation: its name, its first string, its `name = value` arguments. */
function readAnnotation(a: Node, into: Map<string, Ann>, loose?: Node | null) {
  const inv = kid(a, "constructor_invocation");
  const name = typeName(kid(inv ?? a, "user_type"));
  if (!name) return;
  const named: Record<string, Node> = {};
  let first: string | null = null;
  for (const arg of kids(kid(inv, "value_arguments"), "value_argument")) {
    const parts = arg.namedChildren.filter((c): c is Node => !!c);
    if (parts.length === 2 && parts[0].type === "identifier") named[parts[0].text] = parts[1];
    else first ??= firstString(parts[0]);
  }
  // A parse that lost its way leaves the arguments beside the annotation: `@RequestMapping` `("/x")`.
  if (!inv && loose?.type === "parenthesized_expression") first = firstString(loose.namedChildren[0]);
  into.set(name, { first, named });
}
/** A string, or the first one of `["/a", "/b"]`. */
function firstString(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "collection_literal") return strOf(kid(n, "string_literal"));
  return strOf(n);
}
/** The annotations on a declaration, by name. The grammar sometimes reads a class's annotations as a
 * statement of their own in front of it (`annotated_expression`): those are taken too. */
function annotations(decl: Node): Map<string, Ann> {
  const out = new Map<string, Ann>();
  for (const a of kids(kid(decl, "modifiers"), "annotation")) readAnnotation(a, out);
  const loose = (n: Node | null) => {
    if (n?.type !== "annotated_expression") return;
    const rest = n.namedChildren.find((c) => c && c.type !== "annotation") ?? null;
    for (const a of kids(n, "annotation")) readAnnotation(a, out, rest);
    loose(rest);
  };
  if (decl.type === "class_declaration" || decl.type === "object_declaration") loose(decl.previousNamedSibling);
  return out;
}
const hasModifier = (decl: Node, word: string) => (kid(decl, "modifiers")?.namedChildren ?? []).some((c) => c && c.type !== "annotation" && c.text === word);

/** A URL argument: a string with `$id` and `${…}` in it (`*` for each), `BASE + "/x"`, a constant. */
function urlArg(n: Node | null | undefined, consts: FileFacts["consts"]): Url | null {
  if (!n) return null;
  if (n.type === "value_argument") return urlArg(n.namedChildren[n.namedChildren.length - 1], consts);
  const base = (name: string, url: string): Url => {
    const c = consts[name];
    if (c) return { url, fromVariable: true, ...(c.envVar ? { varName: c.envVar } : {}), ...(c.literal ? { literalBase: c.literal } : {}) };
    return { url, fromVariable: true, ...(/^[A-Z_][A-Z0-9_]*$/.test(name) ? { baseIdent: name } : {}) };
  };
  const raw = rawString(n);
  if (raw !== null) {
    const lead = /^\$\{?([A-Za-z_]\w*)\}?/.exec(raw)?.[1];
    const url = raw.replace(/\$\{[^}]*\}|\$[A-Za-z_]\w*/g, "*").replace(/\\\$/g, "$").replace(/\*+/g, "*");
    return lead ? base(lead, url) : { url, fromVariable: false };
  }
  if (n.type === "identifier") {
    const c = consts[n.text];
    if (c?.envVar) return { url: "*", fromVariable: true, varName: c.envVar, ...(c.literal ? { literalBase: c.literal } : {}) };
    return c?.literal ? { url: c.literal, fromVariable: false } : null;
  }
  if (n.type !== "binary_expression" || !n.children.some((c) => c && !c.isNamed && c.text === "+")) return null;
  const left = n.childForFieldName("left");
  const right = urlArg(n.childForFieldName("right"), consts);
  // `"…/users/" + id`: text, then something that is not.
  const l = urlArg(left, consts) ?? (left?.type === "identifier" ? base(left.text, "*") : null);
  if (!l) return null;
  const tail = right && !right.fromVariable ? right.url : "*";
  return { ...l, url: `${l.url}${tail}`.replace(/\*+/g, "*") };
}

/** The type an extension function is on (`fun Route.users()` → Route): the type written before the name. */
function receiverOf(fn: Node): string | null {
  const name = fn.childForFieldName("name");
  const ty = typeIn(fn);
  return name && ty && ty.startIndex < name.startIndex ? typeName(ty) : null;
}

const TYPE_DECLS = ["class_declaration", "object_declaration"];

export function extractKotlin(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const typed: TypedFacts = { namespace: "", types: [], opens: [], refs: [] };
  const entity: EntityFacts = { entities: [], uses: [], fields: {} };
  f.typed = typed;

  // ── package and imports ──
  typed.namespace = kid(kid(root, "package_header"), "qualified_identifier")?.text.replace(/\s+/g, "") ?? "";
  for (const imp of kids(root, "import")) {
    const path = kid(imp, "qualified_identifier")?.text.replace(/\s+/g, "");
    if (!path) continue;
    if (/\.\*\s*$/.test(imp.text)) typed.opens.push({ ns: path, line: line(imp) });
    else {
      const name = path.split(".").pop()!;
      f.imports.push({ spec: path, names: [{ local: kid(imp, "identifier")?.text ?? name, imported: name }], line: line(imp) });
    }
  }

  /** A constant: `const val BASE = "…"`, `val BASE = "…"`, at the top or in an object. */
  const constOf = (p: Node) => {
    const name = kid(kid(p, "variable_declaration"), "identifier")?.text;
    const v = strOf(kid(p, "string_literal"));
    if (name && v !== null && !/\$/.test(rawString(kid(p, "string_literal")) ?? "")) f.consts[name] = { literal: v, line: line(p) };
  };
  /** `@Value("\${users.url}")` on a property or a constructor's parameter: a setting, and what holds it. */
  const settingOf = (decl: Node, name: string | undefined) => {
    const setting = valueSetting(annotations(decl).get("Value")?.first);
    if (!setting) return;
    f.envReads.push({ name: setting.name, line: line(decl) });
    if (name) f.consts[name] = { envVar: setting.name, ...(setting.fallback ? { literal: setting.fallback } : {}), line: line(decl) };
  };

  /** What a body calls, by the types of the names in sight. */
  const callsIn = (body: Node | null, vars: Map<string, string>): string[] => {
    if (!body) return [];
    const out = new Set<string>();
    for (const p of body.descendantsOfType("property_declaration")) {
      const vd = kid(p, "variable_declaration");
      const made = kid(p, "call_expression")?.namedChildren[0];
      const tn = typeName(typeIn(vd)) ?? (made?.type === "identifier" && /^[A-Z]/.test(made.text) ? made.text : null);
      const vn = kid(vd, "identifier")?.text;
      if (tn && vn) vars.set(vn, tn);
    }
    for (const call of body.descendantsOfType("call_expression")) {
      const callee = call?.namedChildren[0];
      if (!callee) continue;
      // `Helper()` makes a Helper; `helper()` calls a function.
      if (callee.type === "identifier") out.add(/^[A-Z]/.test(callee.text) ? `${callee.text}.${callee.text}` : callee.text);
      if (callee.type !== "navigation_expression") continue;
      let recv = callee.namedChildren[0];
      const name = callee.namedChildren[callee.namedChildren.length - 1];
      if (recv?.type === "navigation_expression" && recv.namedChildren[0]?.type === "this_expression") recv = recv.namedChildren[1];
      if (recv?.type !== "identifier" || name?.type !== "identifier") continue;
      const ty = vars.get(recv.text) ?? (/^[A-Z]/.test(recv.text) ? recv.text : null);
      if (ty) out.add(`${ty}.${name.text}`);
    }
    return [...out];
  };

  const fnDecl = (m: Node, owner: string, fields: Map<string, string>, prefix: string) => {
    const mname = m.childForFieldName("name")?.text;
    if (!mname) return;
    const fnName = owner ? `${owner}.${mname}` : mname;
    const vars = new Map(fields);
    for (const p of kids(kid(m, "function_value_parameters"), "parameter")) {
      const tn = typeName(typeIn(p));
      const pn = kid(p, "identifier")?.text;
      if (tn && pn) vars.set(pn, tn);
    }
    f.fns.push({ name: fnName, start: line(m), end: endLine(m), calls: callsIn(kid(m, "function_body"), vars), exported: !hasModifier(m, "private") && !hasModifier(m, "internal") });
    if (owner) f.nested.push({ name: mname, start: line(m), end: endLine(m) });
    // Spring's mapping annotations.
    for (const [an, info] of annotations(m)) {
      if (!(an in MAPPING)) continue;
      let method: Method = MAPPING[an] ?? ((/RequestMethod\.(\w+)/.exec(info.named.method?.text ?? "")?.[1] as Method | undefined) ?? "ANY");
      if (!["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"].includes(method)) method = "ANY";
      const path = info.first ?? firstString(info.named.value ?? info.named.path) ?? "";
      f.routes.push({ method, path: `/${[prefix, path].join("/")}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1"), line: line(m), endLine: endLine(m), handler: fnName });
    }
  };

  const typeDecl = (t: Node, outer: string) => {
    const name = t.childForFieldName("name")?.text;
    if (!name) return;
    const full = outer ? `${outer}.${name}` : name;
    if (!outer) {
      typed.types.push(name);
      if (!hasModifier(t, "private")) f.exports.push(name);
    }
    const ann = annotations(t);
    const prefix = ann.get("RequestMapping")?.first ?? firstString(ann.get("RequestMapping")?.named.value ?? ann.get("RequestMapping")?.named.path) ?? "";

    // A Spring Data repository reads and writes its entity's table.
    for (const spec of kids(kid(t, "delegation_specifiers"), "delegation_specifier")) {
      const ty = kid(spec, "user_type") ?? kid(kid(spec, "constructor_invocation"), "user_type");
      const cls = typeName(kid(kid(kid(ty, "type_arguments"), "type_projection"), "user_type"));
      if (cls && REPOSITORY.test(typeName(ty) ?? "")) entity.uses.push({ cls, op: "read", line: line(t) }, { cls, op: "write", line: line(t) });
    }

    const fields = new Map<string, string>();
    const columns: { name: string; type?: string }[] = [];
    const field = (decl: Node, fname: string | undefined, ty: Node | null, made?: string | null) => {
      if (!fname) return;
      const tn = typeName(ty) ?? made ?? null;
      if (tn) fields.set(fname, tn);
      settingOf(decl, fname);
      const fa = annotations(decl);
      if (!ty || [...fa.keys()].some((k) => RELATION.test(k))) return;
      columns.push({ name: strOf(fa.get("Column")?.named.name) ?? strOf(fa.get("JoinColumn")?.named.name) ?? snake(fname), type: ty.text });
    };
    // The primary constructor's parameters are the class's properties (`val`/`var`) or at least in sight of its body.
    for (const p of kids(kid(kid(t, "primary_constructor"), "class_parameters"), "class_parameter")) field(p, kid(p, "identifier")?.text, typeIn(p));
    const bodies = [kid(t, "class_body"), kid(t, "enum_class_body")].filter((b): b is Node => !!b);
    const members = bodies.flatMap((b) => b.namedChildren.filter((c): c is Node => !!c));
    // A companion's members are the class's own, by its name.
    const shared = new Set(members.flatMap((m) => (m.type === "companion_object" ? (kid(m, "class_body")?.namedChildren ?? []) : [])).map((c) => c?.id));
    const all = members.flatMap((m) => (m.type === "companion_object" ? (kid(m, "class_body")?.namedChildren.filter((c): c is Node => !!c) ?? []) : [m]));
    for (const m of all) {
      if (m.type !== "property_declaration") continue;
      const vd = kid(m, "variable_declaration");
      const made = kid(m, "call_expression")?.namedChildren[0];
      field(m, kid(vd, "identifier")?.text, typeIn(vd), made?.type === "identifier" && /^[A-Z]/.test(made.text) ? made.text : null);
      // One value for every instance: an object's or a companion's property, or a `const`.
      if (t.type === "object_declaration" || shared.has(m.id) || hasModifier(m, "const")) constOf(m);
    }
    if (columns.length) entity.fields[name] = { line: line(t), columns };
    if (ann.has("Entity")) entity.entities.push({ cls: name, table: strOf(ann.get("Table")?.named.name) ?? ann.get("Table")?.first ?? snake(name), line: line(t) });

    for (const m of all) {
      if (TYPE_DECLS.includes(m.type)) typeDecl(m, full);
      else if (m.type === "function_declaration") fnDecl(m, full, fields, prefix);
    }
  };

  for (const c of root.namedChildren) {
    if (!c) continue;
    if (TYPE_DECLS.includes(c.type)) typeDecl(c, "");
    else if (c.type === "function_declaration") {
      const name = c.childForFieldName("name")?.text;
      // An extension (`fun Route.users()`) is not found by its own name.
      if (name && !receiverOf(c)) {
        typed.types.push(name);
        if (!hasModifier(c, "private")) f.exports.push(name);
      }
      fnDecl(c, "", new Map(), "");
    } else if (c.type === "property_declaration") {
      const name = kid(kid(c, "variable_declaration"), "identifier")?.text;
      if (name) typed.types.push(name);
      constOf(c);
    }
  }
  if (entity.entities.length || entity.uses.length || Object.keys(entity.fields).length) f.entity = entity;

  // ── the names the code uses: types, objects called by name, functions called on their own ──
  const declared = new Set(typed.types);
  const refAt = new Map<string, number>();
  const ref = (name: string, at: number) => {
    if (!declared.has(name) && !refAt.has(name)) refAt.set(name, at);
  };
  for (const t of root.descendantsOfType("user_type")) {
    const ids = t ? kids(t, "identifier") : [];
    // A type written in full (`shop.data.Order`) is its own import.
    if (t && ids.length > 1) {
      const spec = ids.map((i) => i.text).join(".");
      if (!f.imports.some((i) => i.spec === spec)) f.imports.push({ spec, names: [{ local: ids[ids.length - 1].text, imported: ids[ids.length - 1].text }], line: line(t) });
    } else if (t && ids.length === 1) ref(ids[0].text, line(t));
  }
  for (const call of root.descendantsOfType("call_expression")) {
    const callee = call?.namedChildren[0];
    if (callee?.type === "identifier") ref(callee.text, line(callee));
    const recv = callee?.type === "navigation_expression" ? callee.namedChildren[0] : null;
    if (recv?.type === "identifier" && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(recv.text)) ref(recv.text, line(recv));
  }
  typed.refs = [...refAt].map(([name, at]) => ({ name, line: at }));

  // ── Ktor routes: `get("/x") { … }` under `routing { }`, `route("/api") { }` or a `fun Route.x()` ──
  for (const call of root.descendantsOfType("call_expression")) {
    const inner = call?.namedChildren[0];
    if (!call || inner?.type !== "call_expression" || !kid(call, "annotated_lambda")) continue;
    const verb = inner.namedChildren[0];
    const method = verb?.type === "identifier" ? KTOR[verb.text] : undefined;
    const path = strOf(kid(kid(inner, "value_arguments"), "value_argument")?.namedChildren[0]);
    if (!method || path === null || !path.startsWith("/")) continue;
    let prefix = "";
    let routed = false;
    for (let p = call.parent; p; p = p.parent) {
      if (p.type === "function_declaration") {
        routed ||= /^(Route|Routing|Application)$/.test(receiverOf(p) ?? "");
        break;
      }
      const outer = p.type === "call_expression" ? p.namedChildren[0] : null;
      const named = outer?.type === "call_expression" ? outer.namedChildren[0] : outer;
      if (named?.type !== "identifier") continue;
      if (named.text === "routing") routed = true;
      if (named.text === "route") {
        routed = true;
        prefix = `${strOf(kid(kid(outer, "value_arguments"), "value_argument")?.namedChildren[0]) ?? ""}/${prefix}`;
      }
    }
    if (routed) f.routes.push({ method, path: `/${prefix}/${path}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1"), line: line(call), endLine: endLine(call) });
  }

  // ── calls: settings and requests (RestTemplate, WebClient, OkHttp, Ktor's client) ──
  const calls = root.descendantsOfType("call_expression").filter((c): c is Node => !!c);
  const nav = (c: Node) => (c.namedChildren[0]?.type === "navigation_expression" ? c.namedChildren[0] : null);
  const nameOf = (c: Node) => nav(c)?.namedChildren[nav(c)!.namedChildren.length - 1]?.text ?? "";
  const recvOf = (c: Node) => nav(c)?.namedChildren[0]?.text.replace(/\s+/g, "") ?? "";
  const argsOf = (c: Node) => kids(kid(c, "value_arguments"), "value_argument");
  const bases = calls.filter((c) => (nameOf(c) === "create" && recvOf(c) === "WebClient") || nameOf(c) === "baseUrl").map((c) => urlArg(argsOf(c)[0], f.consts)).filter((b) => b !== null);
  const clientBase = bases.length === 1 ? bases[0] : null;
  const urlish = (u: { url: string }) => /^(https?:\/\/|\/|\*\/)/.test(u.url);
  const restOfStatement = (call: Node) => {
    let top: Node = call;
    while (top.parent && ["call_expression", "navigation_expression"].includes(top.parent.type)) top = top.parent;
    return src.slice(call.endIndex, top.endIndex);
  };
  for (const call of calls) {
    const name = nameOf(call);
    const obj = recvOf(call);
    const args = argsOf(call);
    if (!name) continue;
    if (name === "getenv" && obj === "System") {
      const v = strOf(args[0]?.namedChildren[0]);
      if (v) {
        f.envReads.push({ name: v, line: line(call) });
        f.services.push(...serviceFacts(v, line(call), "env"));
      }
      continue;
    }
    if (name === "uri" || (name === "url" && /Request\.Builder\(\)/.test(obj))) {
      const verb = name === "uri" ? webClientVerb(obj) : undefined;
      if (!verb && name === "uri") continue;
      const u0 = urlArg(args[0], f.consts);
      const u = u0 && verb ? onBase(u0, clientBase) : u0;
      if (u && urlish(u)) f.http.push({ ...u, method: verb ?? builderVerb(restOfStatement(call)), line: line(call), callee: verb ? "WebClient.uri" : "Request.Builder.url" });
      continue;
    }
    const method = REST_TEMPLATE[name] ?? (/client|http/i.test(obj) ? KTOR[name] : undefined);
    if (!method || !/rest|template|client|http/i.test(obj)) continue;
    const u = urlArg(args[0], f.consts);
    if (u && urlish(u)) f.http.push({ ...u, method, line: line(call), callee: `${obj.split(".").pop()}.${name}` });
  }
  f.envReads.sort((a, b) => a.line - b.line);

  // ── strings: SQL (JDBC, native queries, JPQL) and hosts ──
  const seen = new Set<string>();
  for (const s of root.descendantsOfType("string_literal")) {
    const text = strOf(s);
    if (!s || !text) continue;
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

  f.routes.sort((a, b) => a.line - b.line);
  return f;
}
