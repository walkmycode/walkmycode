// Facts from a C or C++ file: `#include`s, functions and methods (in a class body or
// written `Cart::count`), the structs, classes, enums, typedefs and namespaces a file
// declares, `getenv`, SQL in strings (sqlite3, libpq, MySQL's C API), libcurl's URL.
//
// An `#include "cart.h"` is an import of "cart.h"; `#include <vector>` keeps its angle
// brackets, so build.ts (resolveC) looks for it in the project's include folders only.
// A header names what a file can call: its `exports` are the functions it declares, its
// `scopes` the classes they sit in (`Cart::count()` → "Cart.count") and its `spaces` the
// namespaces around them (`shop::total()` is "total" once build.ts knows shop is one).
// In C++ a method called on a value is named by the value's declared class: `cart.add(1)` on a
// `Cart cart` (a parameter, a local, a field of the class) is "Cart.add"; `auto` counts only when
// what it is given says its class (`Cart()`, `new Cart`, `make_unique<Cart>()`). A method the class
// does not name itself is its base's: `gift.note()` on a Cart that extends Basket is "Basket.note".
// No framework facts: C and C++ have no route or table convention to read.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type FileFacts, type FnFact } from "../facts";
import { serviceFacts, sqlColumns, sqlInString } from "./common";

const line = (n: Node) => n.startPosition.row + 1;
const endLine = (n: Node) => n.endPosition.row + 1;

/** A string literal's text without its quotes and prefix (`u8"x"`, `R"(x)"`). */
function strOf(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === "string_literal") return n.text.replace(/^(u8|[uUL])?"/, "").replace(/"$/, "");
  if (n.type === "raw_string_literal") return n.text.replace(/^(u8|[uUL])?R"[^(]*\(/, "").replace(/\)[^)"]*"$/, "");
  if (n.type === "concatenated_string") return n.namedChildren.map((c) => strOf(c) ?? "").join("");
  return null;
}

/** `shop::Cart::count` without template arguments. */
const plainName = (text: string) => text.replace(/<[^<>]*>/g, "").replace(/\s+/g, "");

/** The function_declarator under a declarator (`*f(int)`, `&f()`, `(f)()`), or null for a variable. */
function fnDeclarator(n: Node | null | undefined): Node | null {
  for (let d = n; d; d = d.childForFieldName("declarator") ?? d.namedChildren.find((c) => c?.type.endsWith("declarator")) ?? null) {
    if (d.type === "function_declarator") return d;
    if (!d.type.endsWith("declarator")) return null;
  }
  return null;
}

/** The name a function_declarator gives: `add`, `Cart::count`, `~Cart`, `operator+`. */
function declaredName(fd: Node): string | null {
  const d = fd.childForFieldName("declarator");
  if (!d) return null;
  if (["identifier", "field_identifier", "qualified_identifier", "destructor_name", "operator_name", "type_identifier"].includes(d.type)) return plainName(d.text);
  return null;
}

/** What a call names: `helper` → "helper", `util::sum` → "util.sum". A method on a value (`x.f()`,
 * `p->f()`) is named by the value's type, in callsIn. */
function calleeOf(fn: Node | null): string | null {
  if (!fn) return null;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "qualified_identifier" || fn.type === "template_function") {
    const t = plainName(fn.text).replace(/^::/, "");
    return /^[\w:]+$/.test(t) ? t.replace(/::/g, ".") : null;
  }
  return null;
}

/** Written like calls, but the language's own. */
const NOT_A_CALL = /^(static_cast|dynamic_cast|const_cast|reinterpret_cast|sizeof|alignof|decltype|typeid|defined)$/;

const NOT_A_CLASS = /^(auto|void|bool|char|short|int|long|float|double|signed|unsigned|size_t|ssize_t|u?int\d+_t|wchar_t|char\d+_t|string|string_view|FILE)$/;
/** A pointer or wrapper around one value: a call through it is a call on what it holds. */
const HOLDER = /^(?:std::)?(?:unique_ptr|shared_ptr|weak_ptr|optional|reference_wrapper)<\s*([\w:]+)\s*>$/;

/** The class a declared type names: `const shop::Cart&` → "Cart", `std::unique_ptr<Cart>` → "Cart"; null for `int`, `auto`, a container. */
export function classOfType(text: string): string | null {
  let t = text.replace(/\b(const|volatile|struct|class|typename|mutable|static|constexpr|inline)\b/g, "").replace(/[&*\s]/g, "");
  t = HOLDER.exec(t)?.[1] ?? t;
  const name = t.split("::").pop() ?? "";
  return /^[A-Za-z_]\w*$/.test(name) && !NOT_A_CLASS.test(name) ? name : null;
}

/** The class an `auto` is, when its initializer says so: `Cart()`, `Cart{}`, `new Cart`, `std::make_unique<Cart>()`. */
function classOfInit(text: string): string | null {
  const t = text.trim();
  const m = /^(?:std::)?make_(?:unique|shared)<\s*([\w:]+)\s*>/.exec(t) ?? /^new\s+([\w:]+)/.exec(t) ?? /^((?:\w+::)*[A-Z]\w*)\s*[({]/.exec(t);
  return m ? classOfType(m[1]) : null;
}

/** The name a declarator gives a variable: `*p`, `&cart`, `items[4]`, `x = 1`, and `checkout(gift)`,
 * which inside a function is an object made with arguments (the grammar reads it as a prototype). */
function declaredVar(d: Node | null | undefined): string | null {
  for (let n = d; n; n = n.childForFieldName("declarator") ?? n.namedChildren.find((c) => c?.type === "identifier" || c?.type.endsWith("declarator")) ?? null) {
    if (n.type === "identifier" || n.type === "field_identifier") return n.text;
  }
  return null;
}

/** What a body calls. `vars` are the classes of the variables in sight (parameters, locals, the class's
 * fields): `cart.add(1)` on a `Cart cart` is "Cart.add". `pending` is the class whose fields are not
 * in this file (a method written outside its class body): a call on an unknown name is kept for
 * settleMemberCalls. A name declared with two classes in one function is nobody's. */
function callsIn(body: Node | null, vars: Map<string, string | null> = new Map(), pending = ""): string[] {
  if (!body) return [];
  const out = new Set<string>();
  const local = new Map(vars);
  const declare = (name: string | null, cls: string | null) => {
    if (!name) return;
    // A local hides a field; two locals of one name and two classes leave it unknown.
    local.set(name, local.has(name) && !vars.has(name) && local.get(name) !== cls ? null : cls);
  };
  for (const d of body.descendantsOfType("declaration")) {
    const ty = d?.childForFieldName("type");
    if (!d || !ty) continue;
    for (const dec of d.namedChildren) {
      if (!dec || dec.id === ty.id || !(dec.type === "identifier" || dec.type.endsWith("declarator"))) continue;
      const init = dec.type === "init_declarator" ? dec.childForFieldName("value") : null;
      declare(declaredVar(dec), classOfType(ty.text) ?? (init ? classOfInit(init.text) : null));
    }
  }
  for (const c of body.descendantsOfType("call_expression")) {
    const fn = c?.childForFieldName("function") ?? null;
    if (fn?.type === "field_expression") {
      const recv = fn.childForFieldName("argument");
      const method = fn.childForFieldName("field");
      if (recv?.type !== "identifier" || method?.type !== "field_identifier") continue;
      const cls = local.get(recv.text);
      if (cls) out.add(`${cls}.${method.text}`);
      else if (cls === undefined && pending) out.add(`~${pending}.${recv.text}.${method.text}`);
      continue;
    }
    const name = calleeOf(fn);
    if (name && !NOT_A_CALL.test(name)) out.add(name);
  }
  return [...out];
}

const isStatic = (n: Node) => n.namedChildren.some((c) => c?.type === "storage_class_specifier" && c.text === "static");
const ENV_CALL = /^(std::)?(secure_)?getenv$/;

export function extractC(root: Node, src: string, cpp = false): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const members: Record<string, Record<string, string>> = {};
  const classes: NonNullable<FileFacts["classes"]> = {};
  const exports = new Set<string>();
  const scopes = new Set<string>();
  const spaces = new Set<string>();

  // ── includes, at any depth (inside #ifdef, extern "C") ──
  for (const inc of root.descendantsOfType("preproc_include")) {
    if (!inc) continue;
    const p = inc.childForFieldName("path");
    const spec = p?.type === "system_lib_string" ? p.text : strOf(p);
    if (spec) f.imports.push({ spec, names: [], line: line(inc) });
  }

  // ── `#define API "https://…"`: a constant ──
  for (const d of root.descendantsOfType("preproc_def")) {
    const name = d?.childForFieldName("name")?.text;
    const v = /^"(.*)"$/.exec(d?.childForFieldName("value")?.text.trim() ?? "");
    if (!d || !name || !v) continue;
    f.consts[name] = { literal: v[1], line: line(d) };
    f.services.push(...serviceFacts(v[1], line(d), "host"));
  }

  // ── functions, methods, and the types and namespaces a file declares ──
  const addFn = (def: Node, prefix: string, hidden: boolean) => {
    const fd = fnDeclarator(def.childForFieldName("declarator"));
    const own = fd ? declaredName(fd) : null;
    if (!own) return;
    // `int Cart::count() {}` already says its class; a method in the class body is given it.
    const name = prefix && !own.includes("::") ? `${prefix}::${own}` : own;
    // C has no methods: `item->fn()` there is a function pointer in a struct, not a call to follow.
    const vars = new Map<string, string | null>(cpp ? Object.entries(members[prefix] ?? {}) : []);
    if (cpp) for (const p of fd!.childForFieldName("parameters")?.namedChildren ?? []) if (p?.type === "parameter_declaration" || p?.type === "optional_parameter_declaration") {
      const v = declaredVar(p.childForFieldName("declarator"));
      if (v) vars.set(v, classOfType(p.childForFieldName("type")?.text ?? ""));
    }
    const outside = cpp && !prefix && own.includes("::") ? own.split("::").slice(-2)[0] : "";
    const calls = cpp ? callsIn(def.childForFieldName("body"), vars, outside) : callsIn(def.childForFieldName("body"));
    const fn: FnFact = { name, start: line(def), end: endLine(def), calls, exported: !hidden && !isStatic(def) };
    f.fns.push(fn);
    if (fn.exported && !name.includes("::")) exports.add(name);
  };
  const walk = (scope: Node, cls: string, hidden: boolean) => {
    for (const c of scope.namedChildren) {
      if (!c) continue;
      switch (c.type) {
        case "function_definition":
          addFn(c, cls, hidden);
          break;
        case "template_declaration":
        case "linkage_specification":
        case "declaration_list":
        case "preproc_ifdef":
        case "preproc_if":
        case "preproc_else":
        case "preproc_elif":
          // A wrapper: what it holds is declared where it stands.
          walk(c, cls, hidden);
          break;
        case "namespace_definition": {
          const name = c.childForFieldName("name")?.text;
          const body = c.childForFieldName("body");
          for (const seg of name?.split("::") ?? []) spaces.add(seg);
          // An unnamed namespace is the file's own, like `static`.
          if (body) walk(body, cls, hidden || !name);
          break;
        }
        case "declaration":
        case "field_declaration": {
          // A prototype: `int total(const Cart& c);`. A method's prototype belongs to its class.
          const fd = fnDeclarator(c.childForFieldName("declarator"));
          const name = fd ? declaredName(fd) : null;
          if (name && !cls && !hidden && !isStatic(c) && !name.includes("::")) exports.add(name);
          typesIn(c, hidden);
          break;
        }
        case "type_definition": {
          const name = c.namedChildren.filter((x) => x?.type === "type_identifier").pop()?.text;
          if (name && !hidden) exports.add(name);
          typesIn(c, hidden);
          break;
        }
        case "class_specifier":
        case "struct_specifier":
        case "union_specifier":
        case "enum_specifier":
          typeOf(c, hidden);
          break;
      }
    }
  };
  /** A struct, class, union or enum with a body: its name, and the methods written in it. */
  const typeOf = (t: Node, hidden: boolean) => {
    const name = t.childForFieldName("name")?.text;
    const body = t.childForFieldName("body");
    if (!body) return;
    if (name && !hidden) {
      exports.add(plainName(name));
      if (t.type !== "enum_specifier") scopes.add(plainName(name));
    }
    if (body.type !== "field_declaration_list") return;
    // What the class extends and the methods it names itself: a method it does not name is a base's (settleInherited).
    if (name && cpp && t.type !== "union_specifier") {
      const bases = (t.namedChildren.find((c) => c?.type === "base_class_clause")?.namedChildren ?? []).filter((b) => b && b.type !== "access_specifier" && b.type !== "virtual").map((b) => classOfType(b!.text.replace(/<[\s\S]*$/, ""))).filter((b): b is string => !!b);
      const methods = new Set<string>();
      for (const m of body.descendantsOfType("function_declarator")) {
        // Only the class's own: not a nested class's, not a lambda's or a local's inside a method's body.
        let own = true;
        for (let p = m?.parent; p && p.id !== body.id; p = p.parent) if (p.type === "field_declaration_list" || p.type === "compound_statement") own = false;
        const n = m && own ? declaredName(m) : null;
        if (n && !n.includes("::")) methods.add(n);
      }
      classes[plainName(name)] = { bases, methods: [...methods] };
    }
    // The class's fields first: its methods call through them.
    if (name) {
      for (const fd of body.namedChildren) {
        if (fd?.type !== "field_declaration" || fnDeclarator(fd.childForFieldName("declarator"))) continue;
        const cls = classOfType(fd.childForFieldName("type")?.text ?? "");
        for (const dec of fd.namedChildren) {
          const v = dec && (dec.type === "field_identifier" || dec.type.endsWith("declarator")) ? declaredVar(dec) : null;
          if (v && cls) (members[plainName(name)] ??= {})[v] = cls;
        }
      }
    }
    walk(body, name ? plainName(name) : "", hidden);
  };
  /** `struct Point { … } origin;`, `typedef struct { … } Pair;`: the type a declaration carries. */
  const typesIn = (decl: Node, hidden: boolean) => {
    const t = decl.childForFieldName("type");
    if (t && ["class_specifier", "struct_specifier", "union_specifier", "enum_specifier"].includes(t.type)) typeOf(t, hidden);
  };
  walk(root, "", false);
  f.exports = [...exports];
  if (scopes.size) f.scopes = [...scopes];
  if (spaces.size) f.spaces = [...spaces];
  if (Object.keys(members).length) f.members = members;
  if (Object.keys(classes).length) f.classes = classes;
  f.nested = f.fns.map((x) => ({ name: x.name.split("::").pop()!, start: x.start, end: x.end }));

  // ── calls: getenv, and the URL libcurl is given ──
  for (const call of root.descendantsOfType("call_expression")) {
    if (!call) continue;
    const name = plainName(call.childForFieldName("function")?.text ?? "");
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    if (ENV_CALL.test(name)) {
      const v = strOf(args[0]);
      if (v) {
        f.envReads.push({ name: v, line: line(call) });
        f.services.push(...serviceFacts(v, line(call), "env"));
      }
    } else if (name === "curl_easy_setopt" && args[1]?.text === "CURLOPT_URL") {
      const lit = strOf(args[2]) ?? (args[2]?.type === "identifier" ? (f.consts[args[2].text]?.literal ?? null) : null);
      if (lit && /^https?:\/\//.test(lit)) f.http.push({ url: lit, line: line(call), callee: name, fromVariable: false });
    }
  }

  // ── strings: SQL and hosts ──
  const seen = new Set<string>();
  const strings = [...root.descendantsOfType("concatenated_string"), ...root.descendantsOfType("string_literal"), ...root.descendantsOfType("raw_string_literal")];
  for (const s of strings) {
    // Adjacent literals ("SELECT … " "FROM t") are one string; its pieces are not read again.
    if (!s || (s.type !== "concatenated_string" && s.parent?.type === "concatenated_string") || s.parent?.type === "preproc_include") continue;
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
  f.sql.sort((a, b) => a.line - b.line);

  return f;
}

/** A header's implementation, for the files that include the header. `cart.h` declares `cart_add`;
 * `cart.c` includes cart.h and defines it; `main.c` includes cart.h and calls it. The call runs
 * code in cart.c, so main.c is linked to cart.c too, on the line of its `#include`. A method is
 * followed one by one: `Cart::add` to the file that defines it, while `Cart::count`, written in
 * the class body, stays at the header. Only when one file alone that includes the header defines
 * the name: two candidates is not an answer. `includes` gives each file's includes (direct, or
 * through another header); the result is what to add for each includer, by the call as written. */
export function linkC(
  facts: Record<string, FileFacts>,
  includes: Map<string, { to: string; line: number }[]>,
): { from: string; to: string; line: number; names: { local: string; name: string }[] }[] {
  /** header → call ("cart_add", "Cart.add") → the file that defines it; null when several do. */
  const impl = new Map<string, Map<string, string | null>>();
  for (const [file, incs] of includes) {
    const defines = (facts[file]?.fns ?? []).filter((fn) => fn.exported).map((fn) => fn.name);
    for (const { to: header } of incs) {
      if (header === file) continue;
      const h = facts[header];
      if (!h) continue;
      // A name the header itself defines (an inline function, a method in the class body) needs no other file.
      const own = new Set(h.fns.map((fn) => fn.name));
      for (const name of defines) {
        // `shop::Cart::add` is Cart's add: the namespaces in front are not part of the call.
        const parts = name.split("::");
        const cls = parts.length > 1 ? parts[parts.length - 2] : null;
        const declared = cls ? h.scopes?.includes(cls) : h.exports.includes(name);
        if (!declared || own.has(parts.slice(-2).join("::"))) continue;
        const m = impl.get(header) ?? new Map<string, string | null>();
        impl.set(header, m);
        const call = parts.slice(-2).join(".");
        m.set(call, m.has(call) && m.get(call) !== file ? null : file);
      }
    }
  }
  const out: { from: string; to: string; line: number; names: { local: string; name: string }[] }[] = [];
  for (const [file, incs] of includes) {
    const calls = new Set<string>();
    for (const fn of facts[file]?.fns ?? []) for (const c of fn.calls) calls.add(c);
    for (const { to: header, line } of incs) {
      const byFile = new Map<string, { local: string; name: string }[]>();
      for (const [call, def] of impl.get(header) ?? []) {
        if (!def || def === file || !calls.has(call)) continue;
        byFile.set(def, [...(byFile.get(def) ?? []), { local: call, name: call.split(".").pop()! }]);
      }
      for (const [to, names] of byFile) out.push({ from: file, to, line, names });
    }
  }
  return out;
}

/** C++: a call on one of the class's own fields, in a method written outside the class body
 * (`void Checkout::run() { cart.add(1); }` with `Cart cart;` in checkout.hpp), is kept as
 * "~Checkout.cart.add" until the class's fields are in sight. Here they are: `fieldsOf` gives a
 * class's fields from this file or a header it includes. A call whose field is not found is dropped. */
export function settleMemberCalls(f: FileFacts, fieldsOf: (cls: string) => Record<string, string> | undefined): void {
  for (const fn of f.fns) {
    if (!fn.calls.some((c) => c.startsWith("~"))) continue;
    const out = new Set<string>();
    for (const c of fn.calls) {
      if (!c.startsWith("~")) {
        out.add(c);
        continue;
      }
      const [cls, field, method] = c.slice(1).split(".");
      const ty = fieldsOf(cls)?.[field];
      if (ty) out.add(`${ty}.${method}`);
    }
    fn.calls = [...out];
  }
}

/** C++: a method called on a class that does not name it is inherited. `gift.note()` on a
 * `class Cart : public Basket` whose body has no `note` becomes "Basket.note", so it is followed
 * to where Basket's note is defined. The nearest base that names the method wins; two bases at
 * the same distance both naming it is not an answer, and the call is dropped. A class or base
 * this file cannot see (`classOf` gives nothing) leaves the call as it was written. Only the
 * static type counts: an override in a derived class is not followed, nor is a template base. */
export function settleInherited(f: FileFacts, classOf: (cls: string) => { bases: string[]; methods: string[] } | undefined): void {
  const owner = (cls: string, method: string): string | null | undefined => {
    const start = classOf(cls);
    if (!start || start.methods.includes(method)) return undefined;
    const seen = new Set([cls]);
    for (let level = start.bases; level.length; ) {
      const known = level.filter((b) => !seen.has(b));
      for (const b of known) seen.add(b);
      const hits = known.filter((b) => classOf(b)?.methods.includes(method));
      if (hits.length) return hits.length === 1 ? hits[0] : null;
      level = known.flatMap((b) => classOf(b)?.bases ?? []);
    }
    return undefined;
  };
  for (const fn of f.fns) {
    const out = new Set<string>();
    for (const c of fn.calls) {
      const parts = c.split(".");
      const base = parts.length === 2 ? owner(parts[0], parts[1]) : undefined;
      if (base === undefined) out.add(c);
      else if (base) out.add(`${base}.${parts[1]}`);
    }
    fn.calls = [...out];
  }
}
