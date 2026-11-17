// Facts from a C# file: its namespace, `using`s and the types it names, classes and
// their methods, ASP.NET Core routes (a controller's `[HttpGet("{id}")]` under its
// `[Route("api/[controller]")]`, and minimal APIs: `app.MapGet("/x", …)`, `MapGroup`),
// EF Core tables (`DbSet<Order> Orders` in a DbContext, named by `[Table("x")]` or
// `.ToTable("x")` when the code names them, columns by `[Column("y")]`) and their use
// (`db.Orders.Add(o)`), HttpClient calls and Refit interfaces (`[Get("/users/{id}")]`),
// settings (`Environment.GetEnvironmentVariable`, `configuration["Users:Url"]`, `GetValue`,
// `GetConnectionString`, which appsettings.json gives a value: config/settings.ts), SQL in strings.
//
// C# finds a type by its namespace, not by a path: `using Shop.Core;` opens a namespace, and
// build.ts (resolveTyped) looks each type the code names (`typed.refs`) up in the file's own
// namespace, the ones around it and the ones it opens. A method is "Class.Method"; a call on a
// field, parameter or local with a declared type is kept by that type (`_orders.Find(id)` on an
// `OrderService _orders` is "OrderService.Find"), as in extract/java.ts.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type EntityFacts, type FileFacts, type HttpCallFact, type Method, type TypedFacts } from "../facts";
import { serviceFacts, sqlColumns, sqlInString } from "./common";

const HTTP_ATTR: Record<string, Method> = { HttpGet: "GET", HttpPost: "POST", HttpPut: "PUT", HttpPatch: "PATCH", HttpDelete: "DELETE", HttpHead: "GET", HttpOptions: "ANY" };
const MAP_CALL: Record<string, Method> = { MapGet: "GET", MapPost: "POST", MapPut: "PUT", MapPatch: "PATCH", MapDelete: "DELETE" };
/** HttpClient's methods (and System.Net.Http.Json's), by the request each sends. */
const HTTP_CALL: Record<string, Method> = {
  GetAsync: "GET", GetStringAsync: "GET", GetStreamAsync: "GET", GetByteArrayAsync: "GET", GetFromJsonAsync: "GET",
  PostAsync: "POST", PostAsJsonAsync: "POST", PutAsync: "PUT", PutAsJsonAsync: "PUT", PatchAsync: "PATCH", PatchAsJsonAsync: "PATCH", DeleteAsync: "DELETE", DeleteFromJsonAsync: "DELETE",
};
/** What changes a table, anywhere in the chain a DbSet starts: `db.Orders.Where(…).ExecuteDeleteAsync()`. */
const EF_WRITE = /^(Add|AddAsync|AddRange|AddRangeAsync|Update|UpdateRange|Remove|RemoveRange|Attach|ExecuteDelete|ExecuteDeleteAsync|ExecuteUpdate|ExecuteUpdateAsync)$/;
/** A name that is a DbContext, when its type is not declared in sight (`var db = …`, a lambda's `db`). */
const CONTEXT_NAME = /^_?(db|ctx|context|dbcontext|[a-z]\w*(Db|Context))$/i;
const TYPE_DECLS = ["class_declaration", "interface_declaration", "struct_declaration", "record_declaration", "enum_declaration"];
/** Refit: an interface method's attribute is the request it sends. */
const REFIT: Record<string, Method> = { Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE", Head: "GET" };
/** A read of the app's settings, as text: `config["A:B"]`, `config.GetSection("A")["B"]`, `.GetValue<T>("A:B")`,
 * `.GetConnectionString("X")` (which is ConnectionStrings:X), `.GetSection("A").Value`. */
const SETTING_READS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/\b\w*[Cc]onfig\w*\s*(?:\.\s*GetSection\(\s*"([^"]+)"\s*\)\s*)?\[\s*"([^"]+)"\s*\]/g, (m) => (m[1] ? `${m[1]}:${m[2]}` : m[2])],
  [/(?:\.\s*GetSection\(\s*"([^"]+)"\s*\)\s*)?\.\s*GetValue\s*(?:<[^>]+>)?\(\s*"([^"]+)"/g, (m) => (m[1] ? `${m[1]}:${m[2]}` : m[2])],
  [/\.\s*GetConnectionString\(\s*"([^"]+)"\s*\)/g, (m) => `ConnectionStrings:${m[1]}`],
  [/\.\s*GetSection\(\s*"([^"]+)"\s*\)\s*\.\s*Value\b/g, (m) => m[1]],
];

const line = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;

/** A string's text: "x", @"x", """x"""; null for anything else (an interpolated string is read by urlArg). */
function strOf(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "string_literal") return n.text.replace(/^"/, "").replace(/"(u8)?$/, "");
  if (n.type === "verbatim_string_literal") return n.text.replace(/^@"/, "").replace(/"$/, "").replace(/""/g, '"');
  if (n.type === "raw_string_literal") return n.text.replace(/^"{3,}\s*\n?/, "").replace(/\s*"{3,}$/, "");
  return null;
}

/** The simple name of a type: `Task<Order>` → "Task", `Shop.Data.Order` → "Order", `Order?` and `Order[]` → "Order". */
function typeName(t: Node | null | undefined): string | null {
  if (!t) return null;
  if (t.type === "identifier") return t.text;
  if (t.type === "generic_name") return t.namedChildren[0]?.text ?? null;
  if (t.type === "qualified_name") return typeName(t.childForFieldName("name"));
  if (t.type === "nullable_type" || t.type === "array_type") return typeName(t.childForFieldName("type") ?? t.namedChildren[0]);
  return null;
}

/** The attributes on a declaration, by name (`HttpGetAttribute` is HttpGet): each with its first string. */
function attributes(decl: Node): Map<string, { first: string | null; node: Node }> {
  const out = new Map<string, { first: string | null; node: Node }>();
  for (const list of decl.namedChildren) {
    if (list?.type !== "attribute_list") continue;
    for (const a of list.namedChildren) {
      if (a?.type !== "attribute") continue;
      const name = (a.childForFieldName("name")?.text.split(".").pop() ?? "").replace(/Attribute$/, "");
      const arg = a.namedChildren.find((c) => c?.type === "attribute_argument_list")?.namedChildren[0];
      out.set(name, { first: strOf(arg?.namedChildren[0]), node: a });
    }
  }
  return out;
}

const hasModifier = (decl: Node, word: string) => decl.namedChildren.some((c) => c?.type === "modifier" && c.text === word);

/** `{id:int}` → `{id}`, `{*rest}` → `{rest}`: a route template's constraints are not part of its path. */
const template = (t: string) => t.replace(/\{\*{0,2}(\w+)[^}]*\}/g, "{$1}");
const joinRoute = (...parts: string[]) => `/${parts.join("/")}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");

/** A URL argument: a literal, `$"{Base}/users/{id}"`, `"…/users/" + id` (`*` for each piece that is not text). */
function urlArg(n: Node | null | undefined, consts: FileFacts["consts"]): Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase" | "baseIdent"> | null {
  if (!n) return null;
  if (n.type === "argument") return urlArg(n.namedChildren[n.namedChildren.length - 1], consts);
  const s = strOf(n);
  if (s !== null) return { url: s, fromVariable: false };
  if (n.type === "identifier" && consts[n.text]?.literal) return { url: consts[n.text].literal!, fromVariable: false };
  let pieces: { text: string | null; ident?: string }[] = [];
  if (n.type === "interpolated_string_expression") {
    const body = n.text.replace(/^[$@]+"+/, "").replace(/"+$/, "");
    const re = /\{([^{}]*)\}|([^{}]+)/g;
    for (let m = re.exec(body); m; m = re.exec(body)) pieces.push(m[2] !== undefined ? { text: m[2] } : { text: null, ident: m[1].trim() });
  } else if (n.type === "binary_expression") {
    const flatten = (x: Node | null) => {
      if (x?.type === "binary_expression" && x.childForFieldName("operator")?.text === "+") {
        flatten(x.childForFieldName("left"));
        flatten(x.childForFieldName("right"));
      } else if (x) pieces.push({ text: strOf(x), ident: x.text });
    };
    flatten(n);
  } else return null;
  pieces = pieces.filter((p) => p.text !== "");
  if (!pieces.some((p) => p.text !== null)) return null;
  const url = pieces.map((p) => p.text ?? "*").join("").replace(/\*+/g, "*");
  const lead = pieces[0];
  if (lead.text !== null) return { url, fromVariable: false };
  const c = lead.ident ? consts[lead.ident] : undefined;
  if (c) return { url, fromVariable: true, ...(c.envVar ? { varName: c.envVar } : {}), ...(c.literal ? { literalBase: c.literal } : {}) };
  return { url, fromVariable: true, ...(lead.ident && /^[A-Z][A-Za-z0-9_]*$/.test(lead.ident) ? { baseIdent: lead.ident } : {}) };
}

/** What a member access hangs off, as a simple name: `_db`, `this._db` → "_db"; null for anything longer. */
function receiver(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "identifier") return n.text;
  if (n.type === "member_access_expression" && n.childForFieldName("expression")?.type === "this") return n.childForFieldName("name")?.text ?? null;
  return null;
}

export function extractCSharp(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const typed: TypedFacts = { namespace: "", types: [], opens: [], refs: [] };
  const entity: EntityFacts = { entities: [], uses: [], fields: {} };
  f.typed = typed;

  // ── usings: a namespace opened, or an alias for one type ──
  for (const u of root.descendantsOfType("using_directive")) {
    if (!u) continue;
    const alias = u.childForFieldName("name")?.text;
    const target = u.namedChildren.filter((c) => c && (c.type === "qualified_name" || c.type === "identifier")).pop()?.text;
    if (!target) continue;
    if (alias && alias !== target) f.imports.push({ spec: target, names: [{ local: alias, imported: target.split(".").pop()! }], line: line(u) });
    else if (!/\bstatic\b/.test(u.text.split(target)[0])) typed.opens.push({ ns: target, line: line(u) });
    else f.imports.push({ spec: target, names: [{ local: target.split(".").pop()!, imported: target.split(".").pop()! }], line: line(u) });
  }

  // ── types, their methods, controller routes and DbSets ──
  const typeDecl = (t: Node, outer: string) => {
    const name = t.childForFieldName("name")?.text;
    if (!name) return;
    const body = t.childForFieldName("body");
    const full = outer ? `${outer}.${name}` : name;
    if (!outer) {
      typed.types.push(name);
      if (!hasModifier(t, "private") && !hasModifier(t, "file")) f.exports.push(name);
    }
    const attrs = attributes(t);
    const bases = t.namedChildren.find((c) => c?.type === "base_list")?.namedChildren.map((b) => typeName(b) ?? "") ?? [];
    const isController = attrs.has("ApiController") || attrs.has("Controller") || bases.some((b) => /Controller(Base)?$/.test(b));
    const controller = name.replace(/Controller$/, "").toLowerCase();
    const fill = (tpl: string, action: string) => template(tpl).replace(/\[controller\]/gi, controller).replace(/\[action\]/gi, action);
    const classRoute = attrs.get("Route")?.first ?? "";
    const isContext = bases.some((b) => /DbContext$/.test(b));

    const fieldTypes = new Map<string, string>();
    const columns: { name: string; type?: string }[] = [];
    const param = (p: Node | null | undefined, into: Map<string, string>) => {
      const tn = typeName(p?.childForFieldName("type"));
      const pn = p?.childForFieldName("name")?.text;
      if (tn && pn) into.set(pn, tn);
    };
    // A primary constructor's parameters are in scope everywhere in the class: `class Orders(ShopContext db)`.
    for (const pl of t.namedChildren) if (pl?.type === "parameter_list") for (const p of pl.namedChildren) param(p, fieldTypes);
    for (const m of body?.namedChildren ?? []) {
      if (!m) continue;
      if (m.type === "field_declaration") {
        const vd = m.namedChildren.find((c) => c?.type === "variable_declaration");
        const tn = typeName(vd?.childForFieldName("type"));
        for (const d of vd?.namedChildren ?? []) if (d?.type === "variable_declarator" && tn) fieldTypes.set(d.childForFieldName("name")?.text ?? "", tn);
      } else if (m.type === "property_declaration") {
        const ty = m.childForFieldName("type");
        const tn = typeName(ty);
        const pn = m.childForFieldName("name")?.text;
        if (!pn || !ty) continue;
        if (tn) fieldTypes.set(pn, tn);
        const set = ty.type === "generic_name" && tn === "DbSet" ? typeName(ty.namedChildren.find((c) => c?.type === "type_argument_list")?.namedChildren[0]) : null;
        const pa = attributes(m);
        if (set && isContext) entity.entities.push({ cls: set, table: pn, line: line(m), set: true });
        // A plain property is a column, named by [Column("x")] when it has one; a list or another class of the
        // project is a relation (settled by its type's name); [NotMapped] is not stored at all.
        else if (!hasModifier(m, "static") && !pa.has("NotMapped") && !/^(ICollection|IEnumerable|IList|List|HashSet|DbSet)$/.test(tn ?? "")) columns.push({ name: pa.get("Column")?.first ?? pn, type: ty.text });
      }
    }
    if (columns.length) entity.fields[name] = { line: line(t), columns };
    // `[Table("orders")]` names the class's table, whatever its DbSet is called.
    const tableName = attrs.get("Table")?.first;
    if (tableName) (entity.names ??= []).push({ cls: name, table: tableName, line: line(t) });

    for (const m of body?.namedChildren ?? []) {
      if (!m) continue;
      if (TYPE_DECLS.includes(m.type)) typeDecl(m, full);
      if (m.type !== "method_declaration" && m.type !== "constructor_declaration") continue;
      const mname = m.childForFieldName("name")?.text;
      if (!mname) continue;
      const fnName = `${full}.${mname}`;
      const vars = new Map(fieldTypes);
      for (const p of m.childForFieldName("parameters")?.namedChildren ?? []) param(p, vars);
      const mbody = m.childForFieldName("body") ?? m.namedChildren.find((c) => c?.type === "arrow_expression_clause") ?? null;
      const calls = callsIn(mbody, vars);
      f.fns.push({ name: fnName, start: line(m), end: endLine(m), calls, exported: hasModifier(m, "public") || hasModifier(m, "internal") || t.type === "interface_declaration" });
      if (m.type === "method_declaration") f.nested.push({ name: mname, start: line(m), end: endLine(m) });
      efUses(mbody, vars);

      // Refit: `[Get("/users/{id}")] Task<User> One(int id);` in an interface is a request, sent to the base the client is given.
      if (t.type === "interface_declaration") {
        for (const [an, info] of attributes(m)) {
          if (REFIT[an] && info.first?.startsWith("/")) f.http.push({ url: info.first.replace(/\{[^}/]*\}/g, "*"), method: REFIT[an], line: line(m), callee: fnName, fromVariable: false });
        }
      }
      // A controller's action: its verb's template under the class's route. A template that starts with / stands alone.
      if (!isController || m.type !== "method_declaration") continue;
      const ma = attributes(m);
      const own = ma.get("Route")?.first;
      for (const [an, info] of ma) {
        const method = HTTP_ATTR[an];
        if (!method) continue;
        const tpl = info.first ?? own ?? "";
        const path = /^~?\//.test(tpl) ? fill(tpl.replace(/^~/, ""), mname) : joinRoute(fill(classRoute, mname), fill(tpl, mname));
        f.routes.push({ method, path: joinRoute(path), line: line(m), endLine: endLine(m), handler: fnName });
      }
    }
  };

  /** What a body calls: `OrderService.Reset()` and `_orders.Find(id)` by the receiver's type, `Helper()` by name. */
  const callsIn = (body: Node | null, vars: Map<string, string>): string[] => {
    const out = new Set<string>();
    if (!body) return [];
    for (const lv of body.descendantsOfType("variable_declaration")) {
      const d = lv?.namedChildren.find((x) => x?.type === "variable_declarator");
      const made = d?.namedChildren.find((x) => x?.type === "object_creation_expression");
      const tn = typeName(lv?.childForFieldName("type")) ?? typeName(made?.childForFieldName("type"));
      const vn = d?.childForFieldName("name")?.text;
      if (tn && vn) vars.set(vn, tn);
    }
    for (const call of body.descendantsOfType("invocation_expression")) {
      const fn = call?.childForFieldName("function");
      if (!fn) continue;
      if (fn.type === "identifier") out.add(fn.text);
      if (fn.type !== "member_access_expression") continue;
      const recv = receiver(fn.childForFieldName("expression"));
      const callee = typeName(fn.childForFieldName("name"));
      if (!recv || !callee) continue;
      const ty = vars.get(recv) ?? (/^[A-Z]/.test(recv) ? recv : null);
      if (ty) out.add(`${ty}.${callee}`);
    }
    for (const nw of body.descendantsOfType("object_creation_expression")) {
      const tn = typeName(nw?.childForFieldName("type"));
      if (tn) out.add(`${tn}.${tn}`);
    }
    return [...out];
  };

  /** `db.Orders…`: a DbSet read, or written when the chain it starts adds, updates or removes. */
  const efUses = (body: Node | null, vars: Map<string, string>) => {
    for (const ma of body?.descendantsOfType("member_access_expression") ?? []) {
      if (!ma) continue;
      const recv = receiver(ma.childForFieldName("expression"));
      const set = ma.childForFieldName("name")?.text;
      if (!recv || !set || !/^[A-Z]/.test(set)) continue;
      const ty = vars.get(recv);
      if (!(ty ? /(Context|Db)$/.test(ty) : CONTEXT_NAME.test(recv))) continue;
      let write = false;
      for (let p: Node | null = ma.parent, cur: Node = ma; p; cur = p, p = p.parent) {
        if (p.type === "member_access_expression" && p.childForFieldName("expression")?.id === cur.id) {
          if (EF_WRITE.test(typeName(p.childForFieldName("name")) ?? "")) write = true;
        } else if (!(p.type === "invocation_expression" && p.childForFieldName("function")?.id === cur.id) && p.type !== "await_expression" && p.type !== "parenthesized_expression") break;
      }
      entity.uses.push({ set, op: write ? "write" : "read", line: line(ma) });
    }
  };

  const scopes = (scope: Node) => {
    for (const c of scope.namedChildren) {
      if (!c) continue;
      if (c.type === "namespace_declaration" || c.type === "file_scoped_namespace_declaration") {
        typed.namespace ||= c.childForFieldName("name")?.text ?? "";
        const body = c.childForFieldName("body");
        if (body) scopes(body);
      } else if (TYPE_DECLS.includes(c.type)) typeDecl(c, "");
    }
  };
  scopes(root);

  // ── minimal APIs: `app.MapGet("/x", handler)`, under the prefix of the group they hang off ──
  const topVars = new Map<string, string>();
  for (const call of root.descendantsOfType("invocation_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    if (fn?.type !== "member_access_expression") continue;
    const name = fn.childForFieldName("name")?.text ?? "";
    const owner = receiver(fn.childForFieldName("expression"));
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    const path = strOf(args[0]?.namedChildren[0]);
    if (name === "MapGroup" && path !== null) {
      // `var api = app.MapGroup("/api")`: the routes on `api` sit under /api (and under what `app` sits under).
      const decl = call.parent?.type === "variable_declarator" ? call.parent.childForFieldName("name")?.text : undefined;
      if (decl) f.ownerPrefix[decl] = joinRoute(owner ? (f.ownerPrefix[owner] ?? "") : "", path);
      continue;
    }
    const method = MAP_CALL[name];
    if (!method || path === null || !owner) continue;
    const h = args[1]?.namedChildren[0];
    const handler = h?.type === "identifier" ? h.text : h?.type === "member_access_expression" ? h.text.replace(/\s+/g, "") : undefined;
    f.routes.push({ method, path: template(path), line: line(call), endLine: endLine(call), ...(handler ? { handler } : {}), owner });
    // A lambda's own `db`: `async (ShopContext db) => await db.Orders.ToListAsync()`.
    if (h?.type === "lambda_expression") {
      const vars = new Map(topVars);
      for (const p of h.childForFieldName("parameters")?.namedChildren ?? []) {
        const tn = typeName(p?.childForFieldName("type"));
        const pn = p?.childForFieldName("name")?.text;
        if (tn && pn) vars.set(pn, tn);
      }
      efUses(h, vars);
    }
  }
  // Top-level statements (Program.cs) are nobody's method: their DbSet uses outside a route's lambda.
  for (const g of root.namedChildren) {
    if (g?.type !== "global_statement") continue;
    const lambdas = g.descendantsOfType("lambda_expression");
    if (!lambdas.length) efUses(g, topVars);
  }
  if (entity.entities.length || entity.uses.length || Object.keys(entity.fields).length) f.entity = entity;

  // ── the types the code names ──
  const declared = new Set(typed.types);
  const refAt = new Map<string, number>();
  const TYPE_PLACES = new Set(["base_list", "type_argument_list", "generic_name", "object_creation_expression", "variable_declaration", "parameter", "property_declaration", "method_declaration", "typeof_expression", "cast_expression", "nullable_type", "array_type", "attribute", "catch_declaration", "is_pattern_expression", "declaration_pattern"]);
  for (const id of root.descendantsOfType("identifier")) {
    const p = id?.parent;
    if (!id || !p || !/^[A-Z]/.test(id.text) || declared.has(id.text) || refAt.has(id.text)) continue;
    const isName = p.childForFieldName("name")?.id === id.id;
    // `OrderService.Reset()`: a class named as a value.
    const asValue = p.type === "member_access_expression" && p.childForFieldName("expression")?.id === id.id;
    if ((TYPE_PLACES.has(p.type) && !(isName && p.type !== "attribute")) || asValue) refAt.set(id.text, line(id));
  }
  typed.refs = [...refAt].map(([name, at]) => ({ name, line: at }));

  // ── constants: `const string Api = "https://…"`, `static readonly string Api = …` ──
  for (const fd of root.descendantsOfType("field_declaration")) {
    if (!fd || !(hasModifier(fd, "const") || (hasModifier(fd, "static") && hasModifier(fd, "readonly")))) continue;
    for (const d of fd.descendantsOfType("variable_declarator")) {
      const name = d?.childForFieldName("name")?.text;
      const v = strOf(d?.namedChildren[d.namedChildren.length - 1]);
      if (name && v !== null && d!.namedChildren.length > 1) f.consts[name] = { literal: v, line: line(fd) };
    }
  }

  // ── EF Core's fluent names: `modelBuilder.Entity<Order>().ToTable("orders")`, `Entity<Order>(e => { e.ToTable("orders"); })` ──
  const lineAt = (offset: number) => 1 + (src.slice(0, offset).match(/\n/g)?.length ?? 0);
  for (const re of [/\bEntity<\s*([\w.]+)\s*>\s*\(\s*\)\s*\.\s*ToTable\(\s*"([^"]+)"/g, /\bEntity<\s*([\w.]+)\s*>\s*\(\s*(\w+)\s*=>(?:(?!\bEntity<)[\s\S]){0,600}?\b\2\s*\.\s*ToTable\(\s*"([^"]+)"/g]) {
    for (let m = re.exec(src); m; m = re.exec(src)) (entity.names ??= []).push({ cls: m[1].split(".").pop()!, table: m[m.length - 1], line: lineAt(m.index + m[0].lastIndexOf("ToTable")) });
  }
  if (entity.names?.length) f.entity = entity;

  // ── settings read from configuration; what one is kept in is a constant bound to it ──
  const lines = src.split("\n");
  for (const [re, nameOf] of SETTING_READS) {
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const at = lineAt(m.index);
      const name = nameOf(m);
      if (f.envReads.some((r) => r.name === name && r.line === at)) continue;
      f.envReads.push({ name, line: at });
      // `_baseUrl = config["Users:Url"] ?? "http://localhost:5001";`
      const text = lines[at - 1] ?? "";
      const holder = /([A-Za-z_]\w*)\s*(?:\{[^}]*\}\s*)?=(?!=)[^=]*$/.exec(text.slice(0, m.index - src.lastIndexOf("\n", m.index) - 1))?.[1];
      const fallback = /\?\?\s*"([^"]*)"/.exec(text)?.[1];
      if (holder) f.consts[holder] = { envVar: name, ...(fallback ? { literal: fallback } : {}), line: at };
    }
  }
  // ── calls: env reads and HttpClient ──
  for (const call of root.descendantsOfType("invocation_expression")) {
    if (!call) continue;
    const fn = call.childForFieldName("function");
    if (fn?.type !== "member_access_expression") continue;
    const name = typeName(fn.childForFieldName("name")) ?? "";
    const obj = fn.childForFieldName("expression")?.text.replace(/\s+/g, "") ?? "";
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    if (name === "GetEnvironmentVariable" && /(^|\.)Environment$/.test(obj)) {
      const v = strOf(args[0]?.namedChildren[0]);
      if (v) {
        f.envReads.push({ name: v, line: line(call) });
        f.services.push(...serviceFacts(v, line(call), "env"));
      }
      continue;
    }
    const method = HTTP_CALL[name];
    if (!method || !/http|client/i.test(obj)) continue;
    const u = urlArg(args[0], f.consts);
    if (u && /^(https?:\/\/|\/|\*\/)/.test(u.url)) f.http.push({ ...u, method, line: line(call), callee: `${obj.split(".").pop()}.${name}` });
  }
  for (const fd of root.descendantsOfType("field_declaration")) {
    if (!fd) continue;
    const read = f.envReads.find((r) => r.line >= line(fd) && r.line <= endLine(fd));
    const name = fd.descendantsOfType("variable_declarator")[0]?.childForFieldName("name")?.text;
    if (read && name) f.consts[name] = { ...(f.consts[name] ?? { line: line(fd) }), envVar: read.name };
  }

  // ── strings: SQL (Dapper, ADO.NET, FromSqlRaw) and hosts ──
  const seen = new Set<string>();
  for (const s of [...root.descendantsOfType("string_literal"), ...root.descendantsOfType("verbatim_string_literal"), ...root.descendantsOfType("raw_string_literal")]) {
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
  f.envReads.sort((a, b) => a.line - b.line);
  return f;
}
