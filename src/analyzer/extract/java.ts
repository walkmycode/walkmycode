// Facts from a Java file: its package, imports and the types it names, classes and
// their methods, Spring MVC routes (`@GetMapping("/x")` under the class's
// `@RequestMapping`), JAX-RS routes (`@Path` with `@GET`), JPA entities (`@Entity`,
// `@Table(name = "x")`) and Spring Data repositories, HTTP calls (RestTemplate, WebClient,
// OkHttp, java.net.http), settings (`System.getenv`, `@Value("${users.url}")`, which
// application.properties or application.yml gives a value: config/settings.ts), SQL in strings.
// Lombok changes nothing here: fields are read where they are written, whoever writes the getters.
//
// Java finds a class by its full name, so an import's spec is that name ("shop.core.OrderService")
// and build.ts (resolveTyped) finds the file that declares it; a class in the same package needs no
// import, so every type the code names is kept too (`typed.refs`). A method is "Class.method". A call
// on a field, parameter or local with a declared type is kept by that type: `orders.find(id)` on an
// `OrderService orders` is "OrderService.find", which is how a call is followed to another file.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type EntityFacts, type FileFacts, type HttpCallFact, type Method, type TypedFacts } from "../facts";
import { serviceFacts, sqlColumns, sqlInString } from "./common";

export const MAPPING: Record<string, Method | null> = { GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT", PatchMapping: "PATCH", DeleteMapping: "DELETE", RequestMapping: null };
export const JAXRS: Record<string, Method> = { GET: "GET", POST: "POST", PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" };
/** RestTemplate's methods, by the request each sends. */
export const REST_TEMPLATE: Record<string, Method> = { getForObject: "GET", getForEntity: "GET", postForObject: "POST", postForEntity: "POST", postForLocation: "POST", put: "PUT", patchForObject: "PATCH", delete: "DELETE" };
/** A Spring Data repository: `interface OrderRepository extends JpaRepository<Order, Long>`. */
export const REPOSITORY = /^(Jpa|Crud|ListCrud|PagingAndSorting|ListPagingAndSorting|Reactive(Crud|Sorting))?Repository$/;
/** A field that is another entity, not a column of this table. */
export const RELATION = /^(OneToMany|ManyToMany|OneToOne|ManyToOne|Transient|ElementCollection)$/;

const line = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;

/** `OrderItem` → "order_item", `totalCents` → "total_cents": Spring Boot's naming of tables and columns. */
export const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();

function strOf(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "string_literal") return n.text.replace(/^"""\s*\n?/, "").replace(/"""$/, "").replace(/^"/, "").replace(/"$/, "");
  return null;
}

/** The annotations on a declaration, by name: its first string, and its `key = value` pairs as text. */
function annotations(decl: Node): Map<string, { first: string | null; pairs: Record<string, Node>; node: Node }> {
  const out = new Map<string, { first: string | null; pairs: Record<string, Node>; node: Node }>();
  const mods = decl.namedChildren.find((c) => c?.type === "modifiers");
  for (const a of mods?.namedChildren ?? []) {
    if (!a || (a.type !== "annotation" && a.type !== "marker_annotation")) continue;
    const name = a.childForFieldName("name")?.text.split(".").pop() ?? "";
    const args = a.childForFieldName("arguments");
    const pairs: Record<string, Node> = {};
    let first: string | null = null;
    for (const arg of args?.namedChildren ?? []) {
      if (!arg) continue;
      if (arg.type === "element_value_pair") {
        const k = arg.childForFieldName("key")?.text;
        const v = arg.childForFieldName("value");
        if (k && v) pairs[k] = v;
      } else first ??= firstString(arg);
    }
    out.set(name, { first, pairs, node: a });
  }
  return out;
}

/** A string, or the first one of `{"/a", "/b"}`. */
function firstString(n: Node | null | undefined): string | null {
  if (!n) return null;
  const s = strOf(n);
  if (s !== null) return s;
  if (n.type === "element_value_array_initializer") return strOf(n.namedChildren.find((c) => c?.type === "string_literal"));
  return null;
}

const hasModifier = (decl: Node, word: string) => new RegExp(`\\b${word}\\b`).test(decl.namedChildren.find((c) => c?.type === "modifiers")?.text.replace(/@\w+(\([^)]*\))?/g, "") ?? "");

/** The simple name of a type: `List<Order>` → "List", `shop.data.Order` → "Order", `Order[]` → "Order". */
function typeName(t: Node | null | undefined): string | null {
  if (!t) return null;
  if (t.type === "type_identifier") return t.text;
  if (t.type === "generic_type") return typeName(t.namedChildren[0]);
  if (t.type === "scoped_type_identifier") return typeName(t.namedChildren[t.namedChildren.length - 1]);
  if (t.type === "array_type") return typeName(t.childForFieldName("element"));
  return null;
}

/** A URL argument: a literal, `"…/users/" + id` (`*` for each piece that is not text), `BASE + "/x"`. */
function urlArg(n: Node | null | undefined, consts: FileFacts["consts"]): Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent"> | null {
  if (!n) return null;
  const s = strOf(n);
  if (s !== null) return { url: s, fromVariable: false };
  // `URI.create("…")` is its argument.
  if (n.type === "method_invocation" && n.childForFieldName("name")?.text === "create" && n.childForFieldName("object")?.text === "URI") return urlArg(n.childForFieldName("arguments")?.namedChildren[0], consts);
  if (n.type === "identifier" && consts[n.text]?.envVar) return { url: "*", fromVariable: true, varName: consts[n.text].envVar, ...(consts[n.text].literal ? { literalBase: consts[n.text].literal } : {}) };
  if (n.type === "identifier" && consts[n.text]?.literal) return { url: consts[n.text].literal!, fromVariable: false };
  if (n.type !== "binary_expression") return null;
  const parts: Node[] = [];
  const flatten = (x: Node | null) => {
    if (x?.type === "binary_expression" && x.childForFieldName("operator")?.text === "+") {
      flatten(x.childForFieldName("left"));
      flatten(x.childForFieldName("right"));
    } else if (x) parts.push(x);
  };
  flatten(n);
  if (!parts.some((p) => strOf(p) !== null)) return null;
  const url = parts.map((p) => strOf(p) ?? "*").join("").replace(/\*+/g, "*");
  const lead = parts[0];
  if (strOf(lead) !== null) return { url, fromVariable: false };
  const c = lead.type === "identifier" ? consts[lead.text] : undefined;
  if (c) return { url, fromVariable: true, ...(c.envVar ? { varName: c.envVar } : {}), ...(c.literal ? { literalBase: c.literal } : {}) };
  return { url, fromVariable: true, ...(lead.type === "identifier" && /^[A-Z_][A-Z0-9_]*$/.test(lead.text) ? { baseIdent: lead.text } : {}) };
}

/** `@Value("${users.url:http://localhost}")`: the setting it reads and its default. */
export function valueSetting(text: string | null | undefined): { name: string; fallback?: string } | null {
  const m = /^\$\{([^:}]+)(?::([^}]*))?\}$/.exec(text?.trim() ?? "");
  return m ? { name: m[1].trim(), ...(m[2] ? { fallback: m[2] } : {}) } : null;
}

/** WebClient's verb, read off what `.uri(…)` is called on: `client.post().uri("/x")`. */
export function webClientVerb(receiver: string): Method | undefined {
  const v = /\.(get|post|put|patch|delete|head)\(\)$/.exec(receiver.replace(/\s+/g, ""))?.[1];
  return v ? (v === "head" ? "GET" : (v.toUpperCase() as Method)) : undefined;
}

/** The verb a request builder is given later in the same statement: OkHttp's `.post(body)`, java.net.http's `.POST(body)`; GET without one. */
export function builderVerb(rest: string): Method {
  const v = /\.(post|put|patch|delete)\s*\(/i.exec(rest)?.[1];
  return v ? (v.toUpperCase() as Method) : "GET";
}

/** A request written against a client's base (`client.get().uri("/users/{id}")`): the whole URL when the base is
 * text, the base's setting in front of the path when it is read from one. `{id}` in a path is `*`. */
export function onBase(
  u: Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent">,
  base: Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent"> | null,
): Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent"> {
  const url = u.url.replace(/\{[^}/]*\}/g, "*");
  if (!url.startsWith("/") || u.fromVariable || !base) return { ...u, url };
  if (!base.fromVariable) return { url: base.url.replace(/\/+$/, "") + url, fromVariable: false };
  if (base.url !== "*") return { ...u, url };
  return { ...base, url: `*${url}` };
}

const TYPE_DECLS = ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"];

export function extractJava(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const typed: TypedFacts = { namespace: "", types: [], opens: [], refs: [] };
  const entity: EntityFacts = { entities: [], uses: [], fields: {} };
  f.typed = typed;

  // ── package and imports ──
  for (const c of root.namedChildren) {
    if (!c) continue;
    if (c.type === "package_declaration") typed.namespace = c.namedChildren.find((x) => x?.type === "scoped_identifier" || x?.type === "identifier")?.text ?? "";
    if (c.type !== "import_declaration") continue;
    const path = c.namedChildren.find((x) => x?.type === "scoped_identifier" || x?.type === "identifier")?.text;
    if (!path) continue;
    if (c.namedChildren.some((x) => x?.type === "asterisk")) typed.opens.push({ ns: path, line: line(c) });
    else {
      const name = path.split(".").pop()!;
      f.imports.push({ spec: path, names: [{ local: name, imported: name }], line: line(c) });
    }
  }

  // ── types, their methods, routes and entities ──
  const typeDecl = (t: Node, outer: string) => {
    const name = t.childForFieldName("name")?.text;
    const body = t.childForFieldName("body");
    if (!name) return;
    const full = outer ? `${outer}.${name}` : name;
    if (!outer) {
      typed.types.push(name);
      f.exports.push(name);
    }
    const ann = annotations(t);
    const prefix = ann.get("RequestMapping")?.first ?? firstString(ann.get("RequestMapping")?.pairs.value ?? ann.get("RequestMapping")?.pairs.path) ?? ann.get("Path")?.first ?? "";

    // A Spring Data repository reads and writes its entity's table.
    for (const g of t.descendantsOfType("generic_type")) {
      if (!g || !["extends_interfaces", "super_interfaces", "superclass", "type_list"].includes(g.parent?.type ?? "")) continue;
      const args = g.namedChildren.find((c) => c?.type === "type_arguments")?.namedChildren ?? [];
      const cls = typeName(args[0]);
      if (!cls || !REPOSITORY.test(typeName(g) ?? "")) continue;
      entity.uses.push({ cls, op: "read", line: line(t) }, { cls, op: "write", line: line(t) });
    }

    // The fields a class holds, by name: what a call on one of them is a call on.
    const fieldTypes = new Map<string, string>();
    const columns: { name: string; type?: string }[] = [];
    for (const m of body?.namedChildren ?? []) {
      if (m?.type !== "field_declaration") continue;
      const ty = m.childForFieldName("type");
      const tn = typeName(ty);
      const fa = annotations(m);
      for (const d of m.namedChildren.filter((x) => x?.type === "variable_declarator")) {
        const fname = d?.childForFieldName("name")?.text;
        if (!fname) continue;
        if (tn) fieldTypes.set(fname, tn);
        if (hasModifier(m, "static") || [...fa.keys()].some((k) => RELATION.test(k))) continue;
        const col = strOf(fa.get("Column")?.pairs.name) ?? strOf(fa.get("JoinColumn")?.pairs.name) ?? snake(fname);
        columns.push({ name: col, ...(ty ? { type: ty.text } : {}) });
      }
    }
    // A record's components are its fields.
    for (const p of t.childForFieldName("parameters")?.namedChildren ?? []) {
      const pn = p?.childForFieldName("name")?.text;
      const tn = typeName(p?.childForFieldName("type"));
      if (pn && tn) fieldTypes.set(pn, tn);
    }
    if (columns.length) entity.fields[name] = { line: line(t), columns };
    if (ann.has("Entity")) {
      const tableAnn = ann.get("Table");
      entity.entities.push({ cls: name, table: strOf(tableAnn?.pairs.name) ?? tableAnn?.first ?? snake(name), line: line(t) });
    }

    for (const m of body?.namedChildren ?? []) {
      if (!m) continue;
      if (TYPE_DECLS.includes(m.type)) typeDecl(m, full);
      if (m.type !== "method_declaration" && m.type !== "constructor_declaration") continue;
      const mname = m.childForFieldName("name")?.text;
      if (!mname) continue;
      const fnName = `${full}.${mname}`;
      const vars = new Map(fieldTypes);
      for (const p of m.childForFieldName("parameters")?.namedChildren ?? []) {
        const tn = typeName(p?.childForFieldName("type"));
        const pn = p?.childForFieldName("name")?.text;
        if (tn && pn) vars.set(pn, tn);
      }
      const mbody = m.childForFieldName("body");
      for (const lv of mbody?.descendantsOfType("local_variable_declaration") ?? []) {
        const d = lv?.namedChildren.find((x) => x?.type === "variable_declarator");
        // `var h = new Helper()` is a Helper too.
        const made = d?.childForFieldName("value")?.type === "object_creation_expression" ? typeName(d.childForFieldName("value")!.childForFieldName("type")) : null;
        const declared = typeName(lv?.childForFieldName("type"));
        const tn = declared && declared !== "var" ? declared : made;
        const vn = d?.childForFieldName("name")?.text;
        if (tn && vn) vars.set(vn, tn);
      }
      const calls = new Set<string>();
      for (const call of mbody?.descendantsOfType("method_invocation") ?? []) {
        if (!call) continue;
        const callee = call.childForFieldName("name")?.text;
        let obj = call.childForFieldName("object");
        if (!callee) continue;
        if (!obj) {
          calls.add(callee);
          continue;
        }
        if (obj.type === "field_access" && obj.childForFieldName("object")?.type === "this") obj = obj.childForFieldName("field");
        if (obj?.type !== "identifier") continue;
        const ty = vars.get(obj.text) ?? (/^[A-Z]/.test(obj.text) ? obj.text : null);
        if (ty) calls.add(`${ty}.${callee}`);
      }
      // `new Helper()` uses Helper's file as surely as a call does.
      for (const nw of mbody?.descendantsOfType("object_creation_expression") ?? []) {
        const tn = typeName(nw?.childForFieldName("type"));
        if (tn) calls.add(`${tn}.${tn}`);
      }
      if (m.type === "method_declaration") {
        f.fns.push({ name: fnName, start: line(m), end: endLine(m), calls: [...calls], exported: hasModifier(m, "public") || t.type === "interface_declaration" });
        f.nested.push({ name: mname, start: line(m), end: endLine(m) });
      } else f.fns.push({ name: fnName, start: line(m), end: endLine(m), calls: [...calls], exported: hasModifier(m, "public") });

      // Routes: Spring's mapping annotations, JAX-RS's verb with an optional @Path.
      const ma = annotations(m);
      for (const [an, info] of ma) {
        let method: Method | undefined;
        let path: string | null = null;
        if (an in MAPPING) {
          method = MAPPING[an] ?? ((/RequestMethod\.(\w+)/.exec(info.pairs.method?.text ?? "")?.[1] as Method | undefined) ?? "ANY");
          if (!["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"].includes(method)) method = "ANY";
          path = info.first ?? firstString(info.pairs.value ?? info.pairs.path) ?? "";
        } else if (an in JAXRS) {
          method = JAXRS[an];
          path = ma.get("Path")?.first ?? "";
        }
        if (!method || path === null) continue;
        const fullPath = `/${[prefix, path].join("/")}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
        f.routes.push({ method, path: fullPath, line: line(m), endLine: endLine(m), handler: fnName });
      }
    }
  };
  for (const c of root.namedChildren) if (c && TYPE_DECLS.includes(c.type)) typeDecl(c, "");
  if (entity.entities.length || entity.uses.length || Object.keys(entity.fields).length) f.entity = entity;

  // ── the types the code names: a class in the same package needs no import ──
  const declared = new Set(typed.types);
  const refAt = new Map<string, number>();
  const ref = (name: string, at: number) => {
    if (name !== "var" && !declared.has(name) && !refAt.has(name)) refAt.set(name, at);
  };
  for (const t of root.descendantsOfType("type_identifier")) if (t && t.parent?.type !== "scoped_type_identifier") ref(t.text, line(t));
  // A type written in full (`private shop.data.OrderRepository repo;`) is its own import.
  for (const t of root.descendantsOfType("scoped_type_identifier")) {
    if (!t || t.parent?.type === "scoped_type_identifier") continue;
    const name = t.text.split(".").pop()!;
    if (!f.imports.some((i) => i.spec === t.text)) f.imports.push({ spec: t.text.replace(/\s+/g, ""), names: [{ local: name, imported: name }], line: line(t) });
  }
  // `OrderService.reset()`, `Money.ZERO`: a class named as a value.
  for (const c of [...root.descendantsOfType("method_invocation"), ...root.descendantsOfType("field_access")]) {
    const o = c?.childForFieldName("object");
    if (o?.type === "identifier" && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(o.text)) ref(o.text, line(o));
  }
  typed.refs = [...refAt].map(([name, at]) => ({ name, line: at }));

  // ── constants: `static final String API = "https://…"` ──
  for (const fd of root.descendantsOfType("field_declaration")) {
    if (!fd || !hasModifier(fd, "static") || !hasModifier(fd, "final")) continue;
    for (const d of fd.namedChildren.filter((x) => x?.type === "variable_declarator")) {
      const name = d?.childForFieldName("name")?.text;
      const v = strOf(d?.childForFieldName("value"));
      if (name && v !== null) f.consts[name] = { literal: v, line: line(fd) };
    }
  }

  // ── settings: `@Value("${users.url}")` on a field or a constructor's parameter ──
  for (const d of [...root.descendantsOfType("field_declaration"), ...root.descendantsOfType("formal_parameter")]) {
    const setting = d ? valueSetting(annotations(d).get("Value")?.first) : null;
    const name = d?.type === "formal_parameter" ? d.childForFieldName("name")?.text : d?.namedChildren.find((x) => x?.type === "variable_declarator")?.childForFieldName("name")?.text;
    if (!d || !setting) continue;
    f.envReads.push({ name: setting.name, line: line(d) });
    if (name) f.consts[name] = { envVar: setting.name, ...(setting.fallback ? { literal: setting.fallback } : {}), line: line(d) };
  }

  // ── calls: settings read at run time, and requests (RestTemplate, WebClient, OkHttp, java.net.http) ──
  const calls = root.descendantsOfType("method_invocation");
  // The one base a WebClient in this file is given: `WebClient.create(base)`, `.baseUrl(base)`.
  const bases = calls
    .filter((c) => c && ((c.childForFieldName("name")?.text === "create" && c.childForFieldName("object")?.text === "WebClient") || c.childForFieldName("name")?.text === "baseUrl"))
    .map((c) => urlArg(c!.childForFieldName("arguments")?.namedChildren[0], f.consts))
    .filter((b) => b !== null);
  const clientBase = bases.length === 1 ? bases[0] : null;
  const urlish = (u: { url: string }) => /^(https?:\/\/|\/|\*\/)/.test(u.url);
  /** What follows a call in its own statement: `.url(x).post(body).build()` → ".post(body).build()". */
  const restOfStatement = (call: Node) => {
    let top: Node = call;
    while (top.parent && !/statement$|declaration$|^return_statement$/.test(top.type)) top = top.parent;
    return src.slice(call.endIndex, top.endIndex);
  };
  for (const call of calls) {
    if (!call) continue;
    const name = call.childForFieldName("name")?.text ?? "";
    const obj = call.childForFieldName("object")?.text ?? "";
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    if ((name === "getProperty" || name === "getRequiredProperty") && /env/i.test(obj)) {
      const v = strOf(args[0]);
      if (v) f.envReads.push({ name: v, line: line(call) });
      continue;
    }
    if (name === "uri" || (name === "url" && /Request\.Builder\(\)/.test(obj)) || (name === "newBuilder" && obj === "HttpRequest" && args.length)) {
      // WebClient names its verb before the URL; the builders (OkHttp, java.net.http) after it.
      const verb = name === "uri" ? webClientVerb(obj) : undefined;
      const builder = name !== "uri" || /HttpRequest\.newBuilder\(/.test(obj);
      if (!verb && !builder) continue;
      const u0 = urlArg(args[0], f.consts);
      const u = u0 && verb ? onBase(u0, clientBase) : u0;
      if (u && urlish(u)) f.http.push({ ...u, method: verb ?? builderVerb(restOfStatement(call)), line: line(call), callee: verb ? "WebClient.uri" : name === "url" ? "Request.Builder.url" : "HttpRequest.newBuilder" });
      continue;
    }
    if (name === "getenv" && obj === "System") {
      const v = strOf(args[0]);
      if (v) {
        f.envReads.push({ name: v, line: line(call) });
        f.services.push(...serviceFacts(v, line(call), "env"));
      }
      continue;
    }
    const method = REST_TEMPLATE[name];
    if (!method || !/rest|template|client|http/i.test(obj)) continue;
    const u = urlArg(args[0], f.consts);
    if (u && urlish(u)) f.http.push({ ...u, method, line: line(call), callee: `${obj.split(".").pop()}.${name}` });
  }
  for (const fd of root.descendantsOfType("field_declaration")) {
    if (!fd) continue;
    const read = f.envReads.find((r) => r.line >= line(fd) && r.line <= endLine(fd));
    const name = fd.namedChildren.find((x) => x?.type === "variable_declarator")?.childForFieldName("name")?.text;
    if (read && name) f.consts[name] = { ...(f.consts[name] ?? { line: line(fd) }), envVar: read.name };
  }

  // ── strings: SQL (JDBC, native queries, JPQL) and hosts ──
  const seen = new Set<string>();
  for (const s of root.descendantsOfType("string_literal")) {
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

  f.routes.sort((a, b) => a.line - b.line);
  return f;
}
