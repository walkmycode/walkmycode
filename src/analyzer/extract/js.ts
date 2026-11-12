// Facts from a JavaScript / TypeScript / JSX file.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type FileFacts, type HttpCallFact, type Method } from "../facts";
import { matchChannel, techsOf, type Arg, type CallInfo } from "./channels";
import { asMethod, serviceFacts, serviceForEnv, serviceForPackage, sqlColumns, sqlInString } from "./common";

const HTTP_PROPS = new Set(["get", "post", "put", "patch", "delete", "del", "request", "fetch"]);
const ROUTE_PROPS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);
const HELPER_RE = /^(fetch|\w*[fF]etch\w*|api\w*|request\w*|http\w*|call\w*|hosted\w*|post|get|put|patch|del|delete|ky|got)$/;
const PRISMA_READ = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);
const PRISMA_WRITE = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const HANDLER_ATTRS = new Set(["onClick", "onSubmit", "onPress", "onDoubleClick", "onKeyDown", "onChange"]);

function unquote(n: Node): string {
  const t = n.text;
  if (n.type === "string") return t.slice(1, -1);
  return t;
}

type Consts = FileFacts["consts"];
interface UrlText {
  url: string;
  fromVariable: boolean;
  varName?: string;
  literalBase?: string;
  baseCall?: string;
  baseIdent?: string;
}

const ENV_MEMBER_RE = /^(?:process\.env|import\.meta\.env|env|c\.env|context\.env)\.([A-Z][A-Z0-9_]+)$/;
const SETTINGS_MEMBER_RE = /^(?:settings|config)\.([A-Z][A-Z0-9_]+)$/;
const ENV_CALL_RE = /^(?:Deno\.env\.get|env\.get|getEnv|config)$/;
const URLISH_RE = /^(?:https?:\/\/|wss?:\/\/|\/|[a-z0-9.-]+:\d+$)/i;

/** A template string with no `${}` in it → its text. */
function plainTemplate(n: Node): string | undefined {
  return n.type === "template_string" && !n.namedChildren.some((c) => c.type === "template_substitution") ? n.text.slice(1, -1) : undefined;
}

/** What an expression stands for when it is an env read (`process.env.X`,
 * `env.X`, `Deno.env.get("X")`, `config("X")`, `settings.X`), a string, or a
 * module constant bound to one of those (one hop, same file). */
function envVarOf(n: Node, consts: Consts): { envVar?: string; literal?: string } | null {
  if (n.type === "identifier") {
    const c = consts[n.text];
    return c ? { envVar: c.envVar, literal: c.literal } : null;
  }
  if (n.type === "string") return { literal: unquote(n) };
  const plain = plainTemplate(n);
  if (plain !== undefined) return { literal: plain };
  if (n.type === "member_expression") {
    const t = n.text.replace(/\s/g, "");
    const m = ENV_MEMBER_RE.exec(t) ?? SETTINGS_MEMBER_RE.exec(t);
    return m ? { envVar: m[1] } : null;
  }
  if (n.type === "subscript_expression") {
    const obj = n.childForFieldName("object")?.text ?? "";
    const idx = n.childForFieldName("index");
    return /env$/.test(obj) && idx?.type === "string" ? { envVar: unquote(idx) } : null;
  }
  if (n.type === "call_expression") {
    const fn = n.childForFieldName("function")?.text.replace(/\s/g, "") ?? "";
    const arg = n.childForFieldName("arguments")?.namedChildren[0];
    return arg?.type === "string" && ENV_CALL_RE.test(fn) ? { envVar: unquote(arg) } : null;
  }
  if (n.type === "parenthesized_expression" || n.type === "non_null_expression" || n.type === "as_expression" || n.type === "satisfies_expression" || n.type === "await_expression") {
    const inner = n.namedChildren[0];
    return inner ? envVarOf(inner, consts) : null;
  }
  if (n.type === "binary_expression") {
    // process.env.X ?? "http://users:8080" — both halves are worth keeping.
    const op = n.childForFieldName("operator")?.text;
    const left = n.childForFieldName("left");
    const right = n.childForFieldName("right");
    if ((op === "??" || op === "||") && left && right) {
      const l = envVarOf(left, consts);
      const r = envVarOf(right, consts);
      if (l?.envVar || r?.literal) return { envVar: l?.envVar, literal: r?.literal ?? l?.literal };
    }
  }
  return null;
}

/** Text of a string or template literal with `*` where code is interpolated.
 * When the URL starts with a variable, `varName`/`literalBase` say what it is bound to. */
function urlText(n: Node, consts: Consts): UrlText | null {
  if (n.type === "string") return { url: unquote(n), fromVariable: false };
  if (n.type === "template_string") {
    let url = "";
    let fromVariable = false;
    let first = true;
    let varName: string | undefined;
    let literalBase: string | undefined;
    const base: Pick<UrlText, "baseCall" | "baseIdent"> = {};
    for (const c of n.children) {
      if (c.type === "`") continue;
      if (c.type === "template_substitution") {
        if (first) {
          fromVariable = true;
          const expr = c.namedChildren[0];
          const e = expr ? envVarOf(expr, consts) : null;
          varName = e?.envVar;
          literalBase = e?.literal;
          if (!e && expr) Object.assign(base, baseRefOf(expr));
        }
        url += "*";
      } else url += c.text;
      first = false;
    }
    return { url, fromVariable, varName, literalBase, ...base };
  }
  if (n.type === "binary_expression") {
    // "base" + "/path" — take the pieces we can see.
    const left = n.childForFieldName("left");
    const right = n.childForFieldName("right");
    const l = left ? urlText(left, consts) : null;
    const r = right ? urlText(right, consts) : null;
    const out: UrlText = { url: (l?.url ?? "*") + (r?.url ?? "*"), fromVariable: !l || l.fromVariable };
    if (l) {
      out.varName = l.varName;
      out.literalBase = l.literalBase;
      if (l.baseCall) out.baseCall = l.baseCall;
      if (l.baseIdent) out.baseIdent = l.baseIdent;
    } else if (left) {
      const e = envVarOf(left, consts);
      out.varName = e?.envVar;
      out.literalBase = e?.literal;
      if (!e) Object.assign(out, baseRefOf(left));
    }
    return out;
  }
  return null;
}

/** What a URL's leading expression names when it is not an env read: a call
 * (`getApiBaseUrl()`) or a name bound elsewhere (an imported `API_BASE`). */
function baseRefOf(n: Node): Pick<UrlText, "baseCall" | "baseIdent"> {
  if (n.type === "await_expression" || n.type === "parenthesized_expression" || n.type === "non_null_expression" || n.type === "as_expression") {
    const inner = n.namedChildren[0];
    return inner ? baseRefOf(inner) : {};
  }
  if (n.type === "call_expression") {
    const name = calleeName(n);
    return name ? { baseCall: name } : {};
  }
  if (n.type === "identifier") return { baseIdent: n.text };
  return {};
}

/** The base fields of a URL for an HttpCallFact, only when there are any. */
function baseFields(u: UrlText): Pick<HttpCallFact, "baseCall" | "baseIdent"> {
  return { ...(u.baseCall ? { baseCall: u.baseCall } : {}), ...(u.baseIdent ? { baseIdent: u.baseIdent } : {}) };
}

function stringChildren(root: Node): Node[] {
  return root.descendantsOfType(["string", "template_string"]);
}

function isTopLevel(n: Node): boolean {
  const p = n.parent;
  if (!p) return true;
  if (p.type === "program") return true;
  if (p.type === "export_statement" && p.parent?.type === "program") return true;
  return false;
}

function calleeName(call: Node): string | null {
  const fn = call.childForFieldName("function") ?? call.childForFieldName("constructor");
  if (!fn) return null;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "member_expression") {
    const obj = fn.childForFieldName("object");
    const prop = fn.childForFieldName("property");
    if (!obj || !prop) return null;
    if (obj.type === "identifier") return `${obj.text}.${prop.text}`;
    if (obj.type === "this") return prop.text;
    if (obj.type === "member_expression") {
      // a.b.c(...) → "a.b.c" when a is an identifier
      const o2 = obj.childForFieldName("object");
      const p2 = obj.childForFieldName("property");
      if (o2?.type === "identifier" && p2) return `${o2.text}.${p2.text}.${prop.text}`;
    }
    return prop.text;
  }
  if (fn.type === "await_expression" || fn.type === "parenthesized_expression") return null;
  return null;
}

function callsIn(body: Node): string[] {
  const out = new Set<string>();
  for (const c of body.descendantsOfType(["call_expression", "new_expression"])) {
    const n = calleeName(c);
    if (n) out.add(n);
  }
  return [...out];
}

export function extractJs(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const routeCallIds = new Set<number>();

  // ── imports ──
  for (const imp of root.descendantsOfType("import_statement")) {
    const source = imp.childForFieldName("source");
    if (!source) continue;
    const spec = unquote(source);
    const names: { local: string; imported: string }[] = [];
    for (const clause of imp.descendantsOfType("import_clause")) {
      for (const c of clause.namedChildren) {
        if (c.type === "identifier") names.push({ local: c.text, imported: "default" });
        else if (c.type === "namespace_import") {
          const id = c.namedChildren.find((x) => x.type === "identifier");
          if (id) names.push({ local: id.text, imported: "*" });
        } else if (c.type === "named_imports") {
          for (const s of c.namedChildren) {
            if (s.type !== "import_specifier") continue;
            const name = s.childForFieldName("name")?.text ?? "";
            const alias = s.childForFieldName("alias")?.text ?? name;
            if (name) names.push({ local: alias, imported: name });
          }
        }
      }
    }
    f.imports.push({ spec, names, line: imp.startPosition.row + 1 });
    const svc = serviceForPackage(spec);
    if (svc) f.services.push({ service: svc, line: imp.startPosition.row + 1, via: "sdk", text: spec });
  }
  // require("x") and import("x")
  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    if (!fn || (fn.type !== "identifier" && fn.type !== "import") || (fn.type === "identifier" && fn.text !== "require")) continue;
    const arg = call.childForFieldName("arguments")?.namedChildren[0];
    if (!arg || arg.type !== "string") continue;
    const spec = unquote(arg);
    const names: { local: string; imported: string }[] = [];
    const decl = call.parent?.type === "variable_declarator" ? call.parent : call.parent?.parent?.type === "variable_declarator" ? call.parent.parent : null;
    const nameNode = decl?.childForFieldName("name");
    if (nameNode?.type === "identifier") names.push({ local: nameNode.text, imported: "*" });
    else if (nameNode?.type === "object_pattern") {
      for (const p of nameNode.namedChildren) {
        if (p.type === "shorthand_property_identifier_pattern") names.push({ local: p.text, imported: p.text });
        else if (p.type === "pair_pattern") {
          const k = p.childForFieldName("key")?.text ?? "";
          const v = p.childForFieldName("value")?.text ?? k;
          if (k) names.push({ local: v, imported: k });
        }
      }
    }
    f.imports.push({ spec, names, line: call.startPosition.row + 1 });
    const svc = serviceForPackage(spec);
    if (svc) f.services.push({ service: svc, line: call.startPosition.row + 1, via: "sdk", text: spec });
  }

  // ── exports ──
  for (const ex of root.descendantsOfType("export_statement")) {
    if (ex.parent?.type !== "program") continue;
    const decl = ex.childForFieldName("declaration");
    if (decl) {
      if (decl.type === "function_declaration" || decl.type === "class_declaration" || decl.type === "abstract_class_declaration") {
        const n = decl.childForFieldName("name")?.text;
        if (n) f.exports.push(n);
      } else if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
        for (const d of decl.namedChildren) {
          const n = d.childForFieldName("name");
          if (n?.type === "identifier") f.exports.push(n.text);
        }
      }
    }
    for (const spec of ex.descendantsOfType("export_specifier")) {
      const n = spec.childForFieldName("alias")?.text ?? spec.childForFieldName("name")?.text;
      if (n) f.exports.push(n);
    }
    if (ex.children.some((c) => c.type === "default")) f.exports.push("default");
  }
  // CommonJS: module.exports = { a, b } / exports.a =
  for (const asg of root.descendantsOfType("assignment_expression")) {
    const left = asg.childForFieldName("left");
    const right = asg.childForFieldName("right");
    if (!left || !right) continue;
    if (left.text === "module.exports") {
      if (right.type === "object") {
        for (const p of right.namedChildren) {
          const k = p.type === "shorthand_property_identifier" ? p.text : p.childForFieldName("key")?.text;
          if (k) f.exports.push(k);
        }
      } else f.exports.push("default");
    } else if (left.type === "member_expression" && left.childForFieldName("object")?.text === "exports") {
      const k = left.childForFieldName("property")?.text;
      if (k) f.exports.push(k);
    }
  }

  // ── functions ──
  const addFn = (name: string, node: Node, body: Node | null, exported: boolean) => {
    f.fns.push({ name, start: node.startPosition.row + 1, end: node.endPosition.row + 1, calls: callsIn(body ?? node), exported });
  };
  for (const fn of root.descendantsOfType("function_declaration")) {
    if (!isTopLevel(fn)) continue;
    const name = fn.childForFieldName("name")?.text;
    if (name) addFn(name, fn, fn.childForFieldName("body"), fn.parent?.type === "export_statement");
  }
  for (const decl of root.descendantsOfType(["lexical_declaration", "variable_declaration"])) {
    if (!isTopLevel(decl)) continue;
    for (const d of decl.namedChildren) {
      if (d.type !== "variable_declarator") continue;
      const name = d.childForFieldName("name");
      const value = d.childForFieldName("value");
      if (!name || name.type !== "identifier" || !value) continue;
      let v = value;
      // React.memo(fn), forwardRef(fn), async wrappers
      if (v.type === "call_expression") {
        const inner = v.childForFieldName("arguments")?.namedChildren.find((a) => a.type === "arrow_function" || a.type === "function_expression");
        if (inner) v = inner;
      }
      if (v.type === "arrow_function" || v.type === "function_expression") {
        addFn(name.text, d, v.childForFieldName("body"), decl.parent?.type === "export_statement");
      }
    }
  }

  // ── module constants: `const BASE = process.env.X ?? "http://…"`, `const { X } = process.env` ──
  for (const decl of root.descendantsOfType(["lexical_declaration", "variable_declaration"])) {
    if (!isTopLevel(decl)) continue;
    for (const d of decl.namedChildren) {
      if (d.type !== "variable_declarator") continue;
      const name = d.childForFieldName("name");
      const value = d.childForFieldName("value");
      if (!name || !value) continue;
      const line = d.startPosition.row + 1;
      if (name.type === "identifier") {
        const e = envVarOf(value, f.consts);
        if (!e) continue;
        const literal = e.literal !== undefined && URLISH_RE.test(e.literal) ? e.literal : undefined;
        if (e.envVar || literal) f.consts[name.text] = { envVar: e.envVar, literal, line };
      } else if (name.type === "object_pattern" && /env$/.test(value.text.replace(/\s/g, ""))) {
        for (const p of name.namedChildren) {
          if (p.type === "shorthand_property_identifier_pattern") f.consts[p.text] = { envVar: p.text, line };
          else if (p.type === "pair_pattern") {
            const k = p.childForFieldName("key")?.text ?? "";
            const v = p.childForFieldName("value")?.text ?? k;
            if (k && v) f.consts[v] = { envVar: k, line };
          }
        }
      }
    }
  }

  // Named functions at any depth: `async function signIn()` inside a component.
  for (const fn of root.descendantsOfType("function_declaration")) {
    const name = fn.childForFieldName("name")?.text;
    if (name && !isTopLevel(fn)) f.nested.push({ name, start: fn.startPosition.row + 1, end: fn.endPosition.row + 1 });
  }
  for (const d of root.descendantsOfType("variable_declarator")) {
    const name = d.childForFieldName("name");
    const value = d.childForFieldName("value");
    if (name?.type !== "identifier" || !value || (value.type !== "arrow_function" && value.type !== "function_expression")) continue;
    if (d.parent && isTopLevel(d.parent)) continue;
    f.nested.push({ name: name.text, start: d.startPosition.row + 1, end: d.endPosition.row + 1 });
  }

  // ── JSX triggers ──
  for (const attr of root.descendantsOfType("jsx_attribute")) {
    const name = attr.namedChildren[0];
    if (!name || !HANDLER_ATTRS.has(name.text)) continue;
    f.hasJsx = true;
    const value = attr.namedChildren[1];
    const expr = value?.type === "jsx_expression" ? value.namedChildren[0] : null;
    if (!expr) continue;
    const tag = attr.parent;
    const element = tag?.childForFieldName("name")?.text ?? "element";
    let label: string | undefined;
    const el = tag?.type === "jsx_opening_element" ? tag.parent : null;
    if (el) {
      const text = el.namedChildren
        .filter((c) => c.type === "jsx_text")
        .map((c) => c.text.trim())
        .filter(Boolean)
        .join(" ");
      if (text) label = text.slice(0, 60);
    }
    if (!label) {
      const aria = tag?.descendantsOfType("jsx_attribute").find((a) => ["aria-label", "title", "placeholder"].includes(a.namedChildren[0]?.text ?? ""));
      const v = aria?.namedChildren[1];
      if (v?.type === "string") label = unquote(v).slice(0, 60);
    }
    const line = attr.startPosition.row + 1;
    if (expr.type === "identifier") f.triggers.push({ element, label, handler: expr.text, line });
    else if (expr.type === "arrow_function" || expr.type === "function_expression") {
      f.triggers.push({ element, label, handler: "inline", line, range: [expr.startPosition.row + 1, expr.endPosition.row + 1] });
      // () => doThing() — the arrow just calls a named handler
      const calls = callsIn(expr);
      if (calls.length === 1) f.triggers[f.triggers.length - 1].handler = calls[0];
    } else if (expr.type === "call_expression") {
      const n = calleeName(expr);
      if (n) f.triggers.push({ element, label, handler: n, line });
    }
  }
  if (!f.hasJsx && root.descendantsOfType(["jsx_element", "jsx_self_closing_element"]).length > 0) f.hasJsx = true;

  // ── owner vars for Express-style routers ──
  const owners = new Set<string>(["app", "router", "server", "api"]);
  for (const d of root.descendantsOfType("variable_declarator")) {
    const name = d.childForFieldName("name");
    const value = d.childForFieldName("value");
    if (!name || !value || name.type !== "identifier") continue;
    const t = value.text.replace(/\s/g, "");
    if (/^(express\(\)|express\.Router\(|Router\(|newHono\(|Hono\(|fastify\(|Fastify\(|newKoa\(|newRouter\()/.test(t)) owners.add(name.text);
  }

  // ── routes (Express style), includes, HTTP calls ──
  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    if (!fn) continue;
    const line = call.startPosition.row + 1;

    if (fn.type === "member_expression") {
      const obj = fn.childForFieldName("object");
      const prop = fn.childForFieldName("property")?.text ?? "";
      const objName = obj?.type === "identifier" ? obj.text : "";
      const first = args[0];
      const firstUrl = first ? urlText(first, f.consts) : null;

      // Express: app.get("/x", handler) / app.use("/x", router)
      if (owners.has(objName) && ROUTE_PROPS.has(prop)) {
        if (prop === "use") {
          const hasPath = first?.type === "string" && unquote(first).startsWith("/");
          const target = hasPath ? args[1] : first;
          if (target && (target.type === "identifier" || target.type === "member_expression")) {
            f.includes.push({ target: target.text, prefix: hasPath ? unquote(first) : "", line });
          }
          routeCallIds.add(call.id);
          continue;
        }
        if (first?.type === "string" && unquote(first).startsWith("/") && args.length >= 2) {
          const handlerArg = args[args.length - 1];
          const handler = handlerArg.type === "identifier" ? handlerArg.text : undefined;
          f.routes.push({
            method: prop === "all" ? "ANY" : (asMethod(prop) as Method),
            path: unquote(first),
            line,
            endLine: call.endPosition.row + 1,
            handler,
            owner: objName,
          });
          routeCallIds.add(call.id);
          continue;
        }
      }

      // Prisma: prisma.user.findMany()
      if (obj?.type === "member_expression" && (PRISMA_READ.has(prop) || PRISMA_WRITE.has(prop))) {
        const model = obj.childForFieldName("property")?.text;
        const base = obj.childForFieldName("object")?.text ?? "";
        if (model && /^(prisma|db|client|tx|ctx\.db|ctx\.prisma|this\.prisma)$/.test(base)) {
          f.sql.push({ table: model, op: PRISMA_READ.has(prop) ? "read" : "write", line });
          continue;
        }
      }

      // Supabase: supabase.from("users").select() / .insert()
      if (prop === "from" && first?.type === "string") {
        let p: Node | null = call.parent;
        let op: "read" | "write" | null = null;
        for (let i = 0; i < 6 && p; i++) {
          if (p.type === "member_expression") {
            const pr = p.childForFieldName("property")?.text ?? "";
            if (pr === "select") op = op ?? "read";
            if (["insert", "update", "upsert", "delete"].includes(pr)) op = "write";
          }
          p = p.parent;
        }
        if (op) {
          f.sql.push({ table: unquote(first), op, line });
          continue;
        }
      }

      // HTTP: axios.post("/x"), client.get("/x"), api.request(...)
      if (HTTP_PROPS.has(prop) && firstUrl && /^(\/|https?:\/\/|wss?:\/\/|\*)/.test(firstUrl.url)) {
        let method = asMethod(prop);
        if (!method) method = methodFromOptions(args[1]);
        const call: HttpCallFact = { url: firstUrl.url, method, line, callee: `${objName || "…"}.${prop}`, fromVariable: firstUrl.fromVariable, varName: firstUrl.varName, literalBase: firstUrl.literalBase, ...baseFields(firstUrl) };
        // env.USERS.fetch(...): a Cloudflare service binding (wrangler.toml [[services]]).
        const binding = prop === "fetch" ? /^(?:env|c\.env|context\.env|ctx\.env|this\.env)\.([A-Z][A-Z0-9_]*)$/.exec(obj?.text.replace(/\s/g, "") ?? "")?.[1] : undefined;
        if (binding) {
          call.binding = binding;
          call.method ??= methodFromOptions(args[1]) ?? "GET";
        }
        f.http.push(call);
        continue;
      }
    }

    if (fn.type === "identifier" && HELPER_RE.test(fn.text)) {
      const first = args[0];
      const u = first ? urlText(first, f.consts) : null;
      if (u && /^(\/|https?:\/\/|wss?:\/\/|\*)/.test(u.url)) {
        let method: Method | undefined = methodFromOptions(args[1]);
        if (!method && fn.text === "fetch") method = "GET";
        if (!method) method = asMethod(fn.text);
        f.http.push({ url: u.url, method, line, callee: fn.text, fromVariable: u.fromVariable, varName: u.varName, literalBase: u.literalBase, ...baseFields(u) });
      }
    }
  }
  // new WebSocket("/ws") / new EventSource("/events")
  for (const ne of root.descendantsOfType("new_expression")) {
    const ctor = ne.childForFieldName("constructor")?.text;
    if (ctor !== "WebSocket" && ctor !== "EventSource") continue;
    const first = ne.childForFieldName("arguments")?.namedChildren[0];
    const u = first ? urlText(first, f.consts) : null;
    if (u) f.http.push({ url: u.url, method: "GET", line: ne.startPosition.row + 1, callee: `new ${ctor}`, fromVariable: u.fromVariable, varName: u.varName, literalBase: u.literalBase, ...baseFields(u) });
  }

  // ── strings: SQL and hosts ──
  const seen = new Set<string>();
  for (const s of stringChildren(root)) {
    const raw = s.type === "string" ? unquote(s) : s.text.slice(1, -1).replace(/\$\{[^}]*\}/g, "?");
    const startLine = s.startPosition.row + 1;
    const lineOf = (off: number) => startLine + (raw.slice(0, off).match(/\n/g)?.length ?? 0);
    for (const q of sqlInString(raw, lineOf)) {
      const k = `${q.table}|${q.op}|${q.line}`;
      if (!seen.has(k)) {
        seen.add(k);
        f.sql.push(q);
      }
    }
    for (const c of sqlColumns(raw, lineOf)) (f.columns ??= []).push(c);
    for (const sv of serviceFacts(raw, startLine, "host")) f.services.push(sv);
  }

  // ── channels: queues and topics, only for the messaging libraries this file imports ──
  const techs = techsOf(f.imports.map((i) => i.spec), "js");
  const strConsts = new Map<string, string>();
  for (const decl of root.descendantsOfType(["lexical_declaration", "variable_declaration"])) {
    if (!isTopLevel(decl)) continue;
    for (const d of decl.namedChildren) {
      const name = d.childForFieldName("name");
      const value = d.childForFieldName("value");
      const lit = value?.type === "string" ? unquote(value) : value ? plainTemplate(value) : undefined;
      if (name?.type === "identifier" && lit !== undefined) strConsts.set(name.text, lit);
    }
  }
  if (techs.size) {
    for (const call of root.descendantsOfType(["call_expression", "new_expression"])) {
      const c = callInfo(call, f.consts, strConsts);
      if (c) f.channels.push(...matchChannel(c, techs));
    }
    // BullMQ / Bull: `const q = new Queue("emails")`, then `q.add(...)` sends, `q.process(...)` (Bull) receives.
    if (techs.has("bullmq")) {
      const queues = new Map<string, { name: string; literal: boolean }>();
      for (const d of root.descendantsOfType("variable_declarator")) {
        const name = d.childForFieldName("name");
        const value = d.childForFieldName("value");
        if (name?.type !== "identifier" || value?.type !== "new_expression" || value.childForFieldName("constructor")?.text !== "Queue") continue;
        const a = argOf(value.childForFieldName("arguments")?.namedChildren[0], f.consts, strConsts);
        if (a.str) queues.set(name.text, { name: a.str, literal: true });
        else if (a.pattern && a.pattern !== "*") queues.set(name.text, { name: a.pattern, literal: false });
      }
      for (const call of root.descendantsOfType("call_expression")) {
        const fn = call.childForFieldName("function");
        if (fn?.type !== "member_expression") continue;
        const q = queues.get(fn.childForFieldName("object")?.text ?? "");
        const prop = fn.childForFieldName("property")?.text;
        if (!q || (prop !== "add" && prop !== "addBulk" && prop !== "process")) continue;
        f.channels.push({ channel: q.name, op: prop === "process" ? "consume" : "publish", tech: "bullmq", line: call.startPosition.row + 1, literal: q.literal });
      }
    }
  }

  // ── gRPC: server.addService(pkg.Users.service, ...) implements Users; new pkg.Users("host:port", ...) calls it ──
  if (f.imports.some((i) => /^(@grpc\/grpc-js|grpc|@grpc\/proto-loader)$/.test(i.spec))) {
    for (const call of root.descendantsOfType("call_expression")) {
      const fn = call.childForFieldName("function");
      if (fn?.type !== "member_expression" || fn.childForFieldName("property")?.text !== "addService") continue;
      const m = /(\w+)\.service$/.exec(call.childForFieldName("arguments")?.namedChildren[0]?.text ?? "");
      if (m) f.rpc.push({ service: m[1], role: "implements", line: call.startPosition.row + 1 });
    }
    for (const ne of root.descendantsOfType("new_expression")) {
      const ctor = ne.childForFieldName("constructor");
      if (ctor?.type !== "member_expression") continue;
      const a = argOf(ne.childForFieldName("arguments")?.namedChildren[0], f.consts, strConsts);
      const host = a.str ?? "";
      if (!/^[\w.-]+:\d+$/.test(host) && !/^(dns|ipv4|unix):/.test(host) && !a.env) continue;
      const service = ctor.childForFieldName("property")?.text;
      if (service) f.rpc.push({ service, role: "calls", ...(a.str ? { host: a.str } : {}), line: ne.startPosition.row + 1 });
    }
  }

  // ── env reads: every one is a fact; the ones naming an outside service are also hints ──
  const envRead = (name: string, line: number) => {
    f.envReads.push({ name, line });
    const svc = serviceForEnv(name);
    if (svc) f.services.push({ service: svc, line, via: "env", text: name });
  };
  for (const m of root.descendantsOfType("member_expression")) {
    const mm = ENV_MEMBER_RE.exec(m.text.replace(/\s/g, ""));
    if (mm) envRead(mm[1], m.startPosition.row + 1);
  }
  for (const sub of root.descendantsOfType("subscript_expression")) {
    const obj = sub.childForFieldName("object")?.text ?? "";
    const idx = sub.childForFieldName("index");
    if (/env$/.test(obj) && idx?.type === "string") envRead(unquote(idx), sub.startPosition.row + 1);
  }
  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function")?.text.replace(/\s/g, "") ?? "";
    const arg = call.childForFieldName("arguments")?.namedChildren[0];
    if (arg?.type === "string" && /^(?:Deno\.env\.get|env\.get)$/.test(fn)) envRead(unquote(arg), call.startPosition.row + 1);
  }
  for (const decl of root.descendantsOfType("variable_declarator")) {
    const name = decl.childForFieldName("name");
    const value = decl.childForFieldName("value");
    if (name?.type !== "object_pattern" || !value || !/env$/.test(value.text.replace(/\s/g, ""))) continue;
    for (const p of name.namedChildren) {
      const k = p.type === "shorthand_property_identifier_pattern" ? p.text : p.type === "pair_pattern" ? p.childForFieldName("key")?.text : undefined;
      if (k) envRead(k, p.startPosition.row + 1);
    }
  }

  return f;
}

/** A call argument as the channel matchers see it (see channels.ts). */
function argOf(n: Node | null | undefined, consts: Consts, strConsts: Map<string, string>, depth = 0): Arg {
  if (!n || depth > 3) return {};
  if (n.type === "string") return { str: unquote(n) };
  if (n.type === "template_string") {
    const plain = plainTemplate(n);
    if (plain !== undefined) return { str: plain };
    const u = urlText(n, consts);
    return u ? { pattern: u.url, ...(u.varName && u.url === "*" ? { env: u.varName } : {}) } : {};
  }
  if (n.type === "identifier" || n.type === "shorthand_property_identifier") {
    const lit = strConsts.get(n.text);
    if (lit !== undefined) return { str: lit };
    const c = consts[n.text];
    return c?.envVar ? { env: c.envVar } : c?.literal ? { str: c.literal } : {};
  }
  if (n.type === "array") return { list: n.namedChildren.map((x) => argOf(x, consts, strConsts, depth + 1)) };
  if (n.type === "object") {
    const obj: Record<string, Arg> = {};
    for (const p of n.namedChildren) {
      if (p.type === "shorthand_property_identifier") obj[p.text] = argOf(p, consts, strConsts, depth + 1);
      else if (p.type === "pair") {
        const k = p.childForFieldName("key");
        const key = k?.type === "string" ? unquote(k) : k?.text;
        if (key) obj[key] = argOf(p.childForFieldName("value"), consts, strConsts, depth + 1);
      }
    }
    return { obj };
  }
  const e = envVarOf(n, consts);
  if (e?.envVar) return { env: e.envVar };
  if (e?.literal !== undefined) return { str: e.literal };
  return {};
}

/** The name a call or `new` goes by, and its receiver: `producer.send` -> send / producer. */
function callInfo(call: Node, consts: Consts, strConsts: Map<string, string>): CallInfo | null {
  const isNew = call.type === "new_expression";
  const fn = call.childForFieldName(isNew ? "constructor" : "function");
  if (!fn) return null;
  let name: string | undefined;
  let object: string | undefined;
  if (fn.type === "identifier") name = fn.text;
  else if (fn.type === "member_expression") {
    name = fn.childForFieldName("property")?.text;
    object = fn.childForFieldName("object")?.text;
  }
  if (!name) return null;
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).map((a) => argOf(a, consts, strConsts));
  return { name, object, args, kwargs: {}, isNew, line: call.startPosition.row + 1 };
}

function methodFromOptions(opts: Node | undefined): Method | undefined {
  if (!opts || opts.type !== "object") return undefined;
  for (const p of opts.namedChildren) {
    if (p.type !== "pair") continue;
    const k = p.childForFieldName("key")?.text.replace(/['"]/g, "");
    const v = p.childForFieldName("value");
    if (k === "method" && v?.type === "string") return asMethod(unquote(v));
  }
  return undefined;
}
