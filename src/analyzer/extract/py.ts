// Facts from a Python file: FastAPI / Flask routes, requests/httpx calls,
// SQL strings, imports, top-level functions.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type FileFacts, type Method } from "../facts";
import { matchChannel, techsOf, type Arg, type CallInfo } from "./channels";
import { asMethod, serviceFacts, serviceForEnv, serviceForPackage, sqlColumns, sqlInString } from "./common";

const ROUTE_ATTRS = new Set(["get", "post", "put", "patch", "delete", "api_route", "route", "websocket", "head", "options"]);
const HTTP_OBJS = /^(requests|httpx|aiohttp|session|client|http|urllib3|_client|self\.client)$/;
const HTTP_ATTRS = new Set(["get", "post", "put", "patch", "delete", "request", "stream", "head"]);

type Consts = FileFacts["consts"];
interface UrlText {
  url: string;
  fromVariable: boolean;
  varName?: string;
  literalBase?: string;
  baseCall?: string;
  baseIdent?: string;
}

/** What a URL's leading expression names when it is not an env read: a call
 * (`api_base()`) or a name bound elsewhere (an imported `API_BASE`). */
function baseRefOf(n: Node): Pick<UrlText, "baseCall" | "baseIdent"> {
  if (n.type === "await" || n.type === "parenthesized_expression") {
    const inner = n.namedChildren[0];
    return inner ? baseRefOf(inner) : {};
  }
  if (n.type === "call") {
    const name = calleeName(n);
    return name ? { baseCall: name } : {};
  }
  if (n.type === "identifier") return { baseIdent: n.text };
  return {};
}

/** The base fields of a URL for an HttpCallFact, only when there are any. */
function baseFields(u: Pick<UrlText, "baseCall" | "baseIdent">): Pick<UrlText, "baseCall" | "baseIdent"> {
  return { ...(u.baseCall ? { baseCall: u.baseCall } : {}), ...(u.baseIdent ? { baseIdent: u.baseIdent } : {}) };
}

const URLISH_RE = /^(?:https?:\/\/|wss?:\/\/|\/|[a-z0-9.-]+:\d+$)/i;
const ENV_CALL_RE = /^(?:os\.getenv|os\.environ\.get|environ\.get|getenv|config|env\.str|env)$/;

/** What an expression stands for when it is an env read (`os.environ["X"]`,
 * `os.getenv("X", "…")`, `settings.X`, `config("X")`), a string, or a
 * module constant bound to one of those (one hop, same file). */
function envVarOf(n: Node, consts: Consts): { envVar?: string; literal?: string } | null {
  if (n.type === "identifier") {
    const c = consts[n.text];
    return c ? { envVar: c.envVar, literal: c.literal } : null;
  }
  if (n.type === "string") {
    const s = strText(n);
    return s.fromVariable || s.text.includes("*") ? null : { literal: s.text };
  }
  if (n.type === "attribute") {
    const m = /^(?:settings|config|os\.environ)\.([A-Z][A-Z0-9_]+)$/.exec(n.text.replace(/\s/g, ""));
    return m ? { envVar: m[1] } : null;
  }
  if (n.type === "subscript") {
    const obj = n.childForFieldName("value")?.text ?? "";
    const idx = n.childForFieldName("subscript");
    return /environ$/.test(obj) && idx?.type === "string" ? { envVar: strText(idx).text } : null;
  }
  if (n.type === "call") {
    const fn = n.childForFieldName("function")?.text.replace(/\s/g, "") ?? "";
    const args = n.childForFieldName("arguments");
    const pos = args?.namedChildren.filter((a) => a.type !== "keyword_argument") ?? [];
    if (!ENV_CALL_RE.test(fn) || pos[0]?.type !== "string") return null;
    const fallback = pos[1] ?? args?.namedChildren.find((a) => a.type === "keyword_argument" && a.childForFieldName("name")?.text === "default")?.childForFieldName("value");
    const lit = fallback?.type === "string" ? strText(fallback).text : undefined;
    return { envVar: strText(pos[0]).text, literal: lit };
  }
  if (n.type === "parenthesized_expression") {
    const inner = n.namedChildren[0];
    return inner ? envVarOf(inner, consts) : null;
  }
  if (n.type === "boolean_operator") {
    // os.getenv("X") or "http://…"
    const l = envVarOf(n.childForFieldName("left")!, consts);
    const r = envVarOf(n.childForFieldName("right")!, consts);
    if (l?.envVar || r?.literal) return { envVar: l?.envVar, literal: r?.literal ?? l?.literal };
  }
  return null;
}

/** Python string → text, with `*` for f-string interpolations. When the first
 * piece is an interpolation, `varName`/`literalBase` say what it is bound to. */
function strText(n: Node, consts: Consts = {}): { text: string; fromVariable: boolean; varName?: string; literalBase?: string } & Pick<UrlText, "baseCall" | "baseIdent"> {
  let text = "";
  let fromVariable = false;
  let first = true;
  let varName: string | undefined;
  let literalBase: string | undefined;
  const base: Pick<UrlText, "baseCall" | "baseIdent"> = {};
  for (const c of n.children) {
    if (c.type === "string_content") text += c.text;
    else if (c.type === "interpolation") {
      if (first) {
        fromVariable = true;
        const expr = c.namedChildren[0];
        const e = expr ? envVarOf(expr, consts) : null;
        varName = e?.envVar;
        literalBase = e?.literal;
        if (!e && expr) Object.assign(base, baseRefOf(expr));
      }
      text += "*";
    } else if (c.type === "string_start" || c.type === "string_end") continue;
    else if (c.type === "escape_sequence") text += c.text;
    first = c.type === "string_start";
  }
  return { text, fromVariable, varName, literalBase, ...base };
}

function urlOf(n: Node | undefined, consts: Consts): UrlText | null {
  if (!n) return null;
  if (n.type === "string") {
    const s = strText(n, consts);
    return { url: s.text, fromVariable: s.fromVariable, varName: s.varName, literalBase: s.literalBase, ...baseFields(s) };
  }
  if (n.type === "concatenated_string") {
    const out: UrlText = { url: "", fromVariable: false };
    n.namedChildren.forEach((c, i) => {
      const s = strText(c, consts);
      out.url += s.text;
      if (i === 0) {
        out.fromVariable = s.fromVariable;
        out.varName = s.varName;
        out.literalBase = s.literalBase;
        Object.assign(out, baseFields(s));
      }
    });
    return out;
  }
  if (n.type === "binary_operator") {
    const left = n.childForFieldName("left") ?? undefined;
    const l = urlOf(left, consts);
    const r = urlOf(n.childForFieldName("right") ?? undefined, consts);
    const out: UrlText = { url: (l?.url ?? "*") + (r?.url ?? "*"), fromVariable: !l || l.fromVariable };
    if (l) {
      out.varName = l.varName;
      out.literalBase = l.literalBase;
      Object.assign(out, baseFields(l));
    } else if (left) {
      const e = envVarOf(left, consts);
      out.varName = e?.envVar;
      out.literalBase = e?.literal;
      if (!e) Object.assign(out, baseRefOf(left));
    }
    return out;
  }
  if (n.type === "call") {
    // "…/{}".format(x)  →  treat like an f-string
    const fn = n.childForFieldName("function");
    if (fn?.type === "attribute" && fn.childForFieldName("attribute")?.text === "format") {
      const base = urlOf(fn.childForFieldName("object") ?? undefined, consts);
      if (base) return { url: base.url.replace(/\{[^}]*\}/g, "*"), fromVariable: base.url.startsWith("{") };
    }
  }
  return null;
}

/** A call argument as the channel matchers see it (see channels.ts). */
function argOf(n: Node | null | undefined, consts: Consts, strConsts: Map<string, string>, depth = 0): Arg {
  if (!n || depth > 3) return {};
  if (n.type === "string" || n.type === "concatenated_string") {
    if (!n.descendantsOfType("interpolation").length) return { str: n.type === "string" ? strText(n).text : n.namedChildren.map((c) => strText(c).text).join("") };
    const u = urlOf(n, consts);
    return u ? { pattern: u.url, ...(u.varName && u.url === "*" ? { env: u.varName } : {}) } : {};
  }
  if (n.type === "identifier") {
    const lit = strConsts.get(n.text);
    if (lit !== undefined) return { str: lit };
    const c = consts[n.text];
    return c?.envVar ? { env: c.envVar } : c?.literal ? { str: c.literal } : {};
  }
  if (n.type === "list" || n.type === "tuple" || n.type === "set") return { list: n.namedChildren.map((x) => argOf(x, consts, strConsts, depth + 1)) };
  if (n.type === "dictionary") {
    const obj: Record<string, Arg> = {};
    for (const p of n.namedChildren) {
      if (p.type !== "pair") continue;
      const k = p.childForFieldName("key");
      if (k?.type === "string") obj[strText(k).text] = argOf(p.childForFieldName("value"), consts, strConsts, depth + 1);
    }
    return { obj };
  }
  const e = envVarOf(n, consts);
  if (e?.envVar) return { env: e.envVar };
  if (e?.literal !== undefined) return { str: e.literal };
  return {};
}

function callInfo(call: Node, consts: Consts, strConsts: Map<string, string>): CallInfo | null {
  const fn = call.childForFieldName("function");
  let name: string | undefined;
  let object: string | undefined;
  if (fn?.type === "identifier") name = fn.text;
  else if (fn?.type === "attribute") {
    name = fn.childForFieldName("attribute")?.text;
    object = fn.childForFieldName("object")?.text;
  }
  if (!name) return null;
  const argNodes = call.childForFieldName("arguments")?.namedChildren ?? [];
  const args: Arg[] = [];
  const kwargs: Record<string, Arg> = {};
  for (const a of argNodes) {
    if (a.type === "keyword_argument") {
      const k = a.childForFieldName("name")?.text;
      if (k) kwargs[k] = argOf(a.childForFieldName("value"), consts, strConsts);
    } else if (a.type !== "list_splat" && a.type !== "dictionary_splat") args.push(argOf(a, consts, strConsts));
  }
  // Python has no `new`: a capitalised callee is taken to be a class (KafkaConsumer("t")).
  return { name, object, args, kwargs, isNew: /^[A-Z]/.test(name), line: call.startPosition.row + 1 };
}

function kwString(args: Node | null, name: string): string | undefined {
  for (const a of args?.namedChildren ?? []) {
    if (a.type !== "keyword_argument") continue;
    if (a.childForFieldName("name")?.text !== name) continue;
    const v = a.childForFieldName("value");
    if (v?.type === "string") return strText(v).text;
    if (v?.type === "list") {
      const s = v.namedChildren.find((x) => x.type === "string");
      return s ? strText(s).text : undefined;
    }
  }
  return undefined;
}

function calleeName(call: Node): string | null {
  const fn = call.childForFieldName("function");
  if (!fn) return null;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "attribute") {
    const obj = fn.childForFieldName("object");
    const attr = fn.childForFieldName("attribute")?.text ?? "";
    if (obj?.type === "identifier") return obj.text === "self" ? attr : `${obj.text}.${attr}`;
    if (obj?.type === "attribute") {
      const o2 = obj.childForFieldName("object");
      const a2 = obj.childForFieldName("attribute")?.text;
      if (o2?.type === "identifier" && a2) return `${o2.text}.${a2}.${attr}`;
    }
    return attr;
  }
  return null;
}

function callsIn(body: Node): string[] {
  const out = new Set<string>();
  for (const c of body.descendantsOfType("call")) {
    const n = calleeName(c);
    if (n) out.add(n);
  }
  return [...out];
}

export function extractPy(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);

  // ── imports ──
  for (const imp of root.descendantsOfType(["import_statement", "import_from_statement"])) {
    const line = imp.startPosition.row + 1;
    if (imp.type === "import_statement") {
      for (const c of imp.namedChildren) {
        if (c.type === "dotted_name") {
          f.imports.push({ spec: c.text, names: [{ local: c.text.split(".")[0], imported: "*" }], line });
          const svc = serviceForPackage(c.text);
          if (svc) f.services.push({ service: svc, line, via: "sdk", text: c.text });
        } else if (c.type === "aliased_import") {
          const name = c.childForFieldName("name")?.text ?? "";
          const alias = c.childForFieldName("alias")?.text ?? name;
          f.imports.push({ spec: name, names: [{ local: alias, imported: "*" }], line });
          const svc = serviceForPackage(name);
          if (svc) f.services.push({ service: svc, line, via: "sdk", text: name });
        }
      }
    } else {
      const mod = imp.childForFieldName("module_name");
      const spec = mod?.text ?? "";
      const names: { local: string; imported: string }[] = [];
      for (const c of imp.childrenForFieldName("name")) {
        if (c.type === "dotted_name") names.push({ local: c.text, imported: c.text });
        else if (c.type === "aliased_import") {
          const name = c.childForFieldName("name")?.text ?? "";
          names.push({ local: c.childForFieldName("alias")?.text ?? name, imported: name });
        }
      }
      if (imp.children.some((c) => c.type === "wildcard_import")) names.push({ local: "*", imported: "*" });
      f.imports.push({ spec, names, line });
      const svc = serviceForPackage(spec);
      if (svc) f.services.push({ service: svc, line, via: "sdk", text: spec });
    }
  }

  // ── router prefixes: router = APIRouter(prefix="/x"), Blueprint(..., url_prefix=) ──
  for (const asg of root.descendantsOfType("assignment")) {
    const left = asg.childForFieldName("left");
    const right = asg.childForFieldName("right");
    if (!left || !right || left.type !== "identifier" || right.type !== "call") continue;
    const fn = right.childForFieldName("function")?.text ?? "";
    if (/(^|\.)(APIRouter|Blueprint|FastAPI|Flask)$/.test(fn)) {
      const prefix = kwString(right.childForFieldName("arguments"), "prefix") ?? kwString(right.childForFieldName("arguments"), "url_prefix") ?? "";
      f.ownerPrefix[left.text] = prefix;
    }
  }
  for (const asg of root.descendantsOfType("assignment")) {
    const left = asg.childForFieldName("left");
    const right = asg.childForFieldName("right");
    if (left?.text === "__tablename__" && right?.type === "string") {
      const table = strText(right).text;
      f.sql.push({ table, op: "define", line: asg.startPosition.row + 1 });
      // SQLAlchemy: the class's `title = Column(String(50))` and `title: Mapped[str] = mapped_column()`.
      const columns: { name: string; type?: string }[] = [];
      for (const st of asg.parent?.parent?.type === "block" ? asg.parent.parent.namedChildren : []) {
        const a = st.type === "expression_statement" ? st.namedChildren[0] : undefined;
        if (a?.type !== "assignment") continue;
        const name = a.childForFieldName("left");
        const call = a.childForFieldName("right");
        if (name?.type !== "identifier" || call?.type !== "call" || !/(^|\.)(Column|mapped_column)$/.test(call.childForFieldName("function")?.text ?? "")) continue;
        const args = call.childForFieldName("arguments")?.namedChildren ?? [];
        const own = args[0]?.type === "string" ? strText(args[0]).text : undefined;
        const typeArg = args.find((x) => x.type !== "string" && x.type !== "keyword_argument" && !/^ForeignKey\b/.test(x.text.replace(/^\w+\./, "")));
        const hinted = /^Mapped\[(.+)\]$/.exec(a.childForFieldName("type")?.text ?? "")?.[1];
        const type = typeArg?.text.replace(/^(db|sa|sqlalchemy)\./, "") ?? hinted;
        columns.push(type ? { name: own ?? name.text, type } : { name: own ?? name.text });
      }
      if (columns.length) (f.columns ??= []).push({ table, columns, line: asg.startPosition.row + 1 });
    }
  }

  // ── module constants: `BASE = os.getenv("X", "http://…")`, `BASE = "http://…"` ──
  for (const asg of root.descendantsOfType("assignment")) {
    if (asg.parent?.type !== "expression_statement" || asg.parent.parent?.type !== "module") continue;
    const left = asg.childForFieldName("left");
    const right = asg.childForFieldName("right");
    if (left?.type !== "identifier" || !right) continue;
    const e = envVarOf(right, f.consts);
    if (!e) continue;
    const literal = e.literal !== undefined && URLISH_RE.test(e.literal) ? e.literal : undefined;
    if (e.envVar || literal) f.consts[left.text] = { envVar: e.envVar, literal, line: asg.startPosition.row + 1 };
  }

  // ── functions and routes ──
  const isTop = (n: Node) => n.parent?.type === "module" || (n.parent?.type === "decorated_definition" && n.parent.parent?.type === "module");
  for (const fn of root.descendantsOfType("function_definition")) {
    if (!isTop(fn)) continue;
    const name = fn.childForFieldName("name")?.text;
    if (!name) continue;
    const whole = fn.parent?.type === "decorated_definition" ? fn.parent : fn;
    const body = fn.childForFieldName("body");
    f.fns.push({ name, start: whole.startPosition.row + 1, end: whole.endPosition.row + 1, calls: body ? callsIn(body) : [], exported: !name.startsWith("_") });
    f.exports.push(name);
    if (fn.parent?.type !== "decorated_definition") continue;
    for (const dec of fn.parent.namedChildren.filter((c) => c.type === "decorator")) {
      const call = dec.namedChildren.find((c) => c.type === "call");
      if (!call) continue;
      const cf = call.childForFieldName("function");
      if (cf?.type !== "attribute") continue;
      const owner = cf.childForFieldName("object")?.text ?? "";
      const attr = cf.childForFieldName("attribute")?.text ?? "";
      if (!ROUTE_ATTRS.has(attr)) continue;
      const args = call.childForFieldName("arguments");
      const first = args?.namedChildren[0];
      const p = first?.type === "string" ? strText(first).text : kwString(args, "path");
      if (p === undefined) continue;
      let method: Method = "ANY";
      if (attr === "api_route" || attr === "route") method = asMethod(kwString(args, "methods")) ?? "ANY";
      else if (attr === "websocket") method = "GET";
      else method = asMethod(attr) ?? "ANY";
      f.routes.push({ method, path: p, line: whole.startPosition.row + 1, endLine: whole.endPosition.row + 1, handler: name, owner });
    }
  }
  // Decorators on nested functions (routes declared inside a setup function)
  for (const dec of root.descendantsOfType("decorator")) {
    const def = dec.parent;
    if (!def || def.type !== "decorated_definition" || def.parent?.type === "module") continue;
    const call = dec.namedChildren.find((c) => c.type === "call");
    const cf = call?.childForFieldName("function");
    if (!call || cf?.type !== "attribute") continue;
    const attr = cf.childForFieldName("attribute")?.text ?? "";
    if (!ROUTE_ATTRS.has(attr)) continue;
    const first = call.childForFieldName("arguments")?.namedChildren[0];
    if (first?.type !== "string") continue;
    const fnDef = def.childForFieldName("definition");
    f.routes.push({
      method: asMethod(attr) ?? "ANY",
      path: strText(first).text,
      line: def.startPosition.row + 1,
      endLine: def.endPosition.row + 1,
      handler: fnDef?.childForFieldName("name")?.text,
      owner: cf.childForFieldName("object")?.text ?? "",
    });
  }
  for (const cls of root.descendantsOfType("class_definition")) {
    if (cls.parent?.type !== "module") continue;
    const name = cls.childForFieldName("name")?.text;
    if (name) f.exports.push(name);
  }

  // ── calls: include_router, HTTP, env ──
  // Every env read is a fact; the ones naming an outside service are also hints.
  const envRead = (name: string, line: number) => {
    f.envReads.push({ name, line });
    const svc = serviceForEnv(name);
    if (svc) f.services.push({ service: svc, line, via: "env", text: name });
  };
  for (const call of root.descendantsOfType("call")) {
    const fn = call.childForFieldName("function");
    const args = call.childForFieldName("arguments");
    const pos = args?.namedChildren.filter((a) => a.type !== "keyword_argument") ?? [];
    const line = call.startPosition.row + 1;
    if (!fn) continue;
    if (fn.type === "attribute") {
      const obj = fn.childForFieldName("object")?.text ?? "";
      const attr = fn.childForFieldName("attribute")?.text ?? "";
      if (attr === "include_router" || attr === "register_blueprint") {
        const target = pos[0]?.text;
        if (target) f.includes.push({ target, prefix: kwString(args, "prefix") ?? kwString(args, "url_prefix") ?? "", line });
        continue;
      }
      if (HTTP_ATTRS.has(attr) && HTTP_OBJS.test(obj)) {
        const u = urlOf(pos[attr === "request" || attr === "stream" ? 1 : 0], f.consts) ?? urlOf(pos[0], f.consts);
        if (u && /^(\/|https?:\/\/|wss?:\/\/|\*)/.test(u.url)) {
          let method = asMethod(attr);
          if (!method && pos[0]?.type === "string") method = asMethod(strText(pos[0]).text);
          f.http.push({ url: u.url, method, line, callee: `${obj}.${attr}`, fromVariable: u.fromVariable, varName: u.varName, literalBase: u.literalBase, ...baseFields(u) });
        }
        continue;
      }
      if ((obj === "os" && attr === "getenv") || ((obj === "os.environ" || obj === "environ") && attr === "get")) {
        if (pos[0]?.type === "string") envRead(strText(pos[0]).text, line);
      }
    } else if (fn.type === "identifier" && (fn.text === "urlopen" || fn.text === "Request")) {
      const u = urlOf(pos[0], f.consts);
      if (u) f.http.push({ url: u.url, method: "GET", line, callee: fn.text, fromVariable: u.fromVariable, varName: u.varName, literalBase: u.literalBase, ...baseFields(u) });
    } else if (fn.type === "identifier" && fn.text === "getenv" && pos[0]?.type === "string") {
      envRead(strText(pos[0]).text, line);
    }
  }
  for (const sub of root.descendantsOfType("subscript")) {
    const obj = sub.childForFieldName("value")?.text ?? "";
    if (obj !== "os.environ" && obj !== "environ") continue;
    const idx = sub.childForFieldName("subscript");
    if (idx?.type === "string") envRead(strText(idx).text, sub.startPosition.row + 1);
  }

  // ── channels: queues and topics, only for the messaging libraries this file imports ──
  const techs = techsOf(f.imports.map((i) => i.spec), "py");
  const strConsts = new Map<string, string>();
  for (const asg of root.descendantsOfType("assignment")) {
    if (asg.parent?.type !== "expression_statement" || asg.parent.parent?.type !== "module") continue;
    const left = asg.childForFieldName("left");
    const right = asg.childForFieldName("right");
    if (left?.type === "identifier" && right?.type === "string" && !right.descendantsOfType("interpolation").length) strConsts.set(left.text, strText(right).text);
  }
  if (techs.size) {
    for (const call of root.descendantsOfType("call")) {
      const c = callInfo(call, f.consts, strConsts);
      if (c) f.channels.push(...matchChannel(c, techs));
    }
  }
  // Celery: a task receives from its queue ("celery" unless it names one); .delay() /
  // .apply_async() / send_task() put a message on it. The task name is kept apart from the queue.
  const celeryish = techs.has("celery") || f.imports.some((i) => /(^|\.)celery$/.test(i.spec));
  for (const fn of root.descendantsOfType("function_definition")) {
    const def = fn.parent;
    if (def?.type !== "decorated_definition" || def.parent?.type !== "module") continue;
    for (const dec of def.namedChildren.filter((c) => c.type === "decorator")) {
      const expr = dec.namedChildren[0];
      const target = expr?.type === "call" ? expr.childForFieldName("function") : expr;
      const t = target?.text.replace(/\s/g, "") ?? "";
      if (!(t === "shared_task" || (celeryish && /(^|\.)task$/.test(t)))) continue;
      const args = expr?.type === "call" ? expr.childForFieldName("arguments") : null;
      const queue = kwString(args, "queue");
      const name = fn.childForFieldName("name")?.text;
      if (!name) continue;
      f.channels.push({ channel: queue ?? "celery", op: "consume", tech: "celery", line: def.startPosition.row + 1, literal: true, task: kwString(args, "name") ?? name });
    }
  }
  for (const call of root.descendantsOfType("call")) {
    const fn = call.childForFieldName("function");
    if (fn?.type !== "attribute") continue;
    const attr = fn.childForFieldName("attribute")?.text ?? "";
    const obj = fn.childForFieldName("object");
    const args = call.childForFieldName("arguments");
    const line = call.startPosition.row + 1;
    if ((attr === "delay" || attr === "apply_async") && obj?.type === "identifier") {
      f.channels.push({ channel: kwString(args, "queue") ?? "celery", op: "publish", tech: "celery", line, literal: true, task: obj.text });
    } else if (attr === "send_task") {
      const first = args?.namedChildren[0];
      if (first?.type === "string") f.channels.push({ channel: kwString(args, "queue") ?? "celery", op: "publish", tech: "celery", line, literal: true, task: strText(first).text, sendTask: true });
    }
  }

  // ── gRPC: add_UsersServicer_to_server(...) implements Users; UsersStub(channel) calls it ──
  if (f.imports.some((i) => /^grpc(\.|$)|_pb2_grpc$/.test(i.spec))) {
    const channels: { host: string; line: number }[] = [];
    for (const call of root.descendantsOfType("call")) {
      const fn = call.childForFieldName("function")?.text.replace(/\s/g, "") ?? "";
      const first = call.childForFieldName("arguments")?.namedChildren[0];
      if (/(^|\.)(insecure_channel|secure_channel)$/.test(fn) && first?.type === "string") channels.push({ host: strText(first).text, line: call.startPosition.row + 1 });
    }
    const fnOf = (line: number) => f.fns.find((x) => line >= x.start && line <= x.end);
    for (const call of root.descendantsOfType("call")) {
      const fn = call.childForFieldName("function");
      const name = fn?.type === "attribute" ? fn.childForFieldName("attribute")?.text : fn?.type === "identifier" ? fn.text : undefined;
      if (!name) continue;
      const line = call.startPosition.row + 1;
      const impl = /^add_(\w+)Servicer_to_server$/.exec(name);
      if (impl) {
        f.rpc.push({ service: impl[1], role: "implements", line });
        continue;
      }
      const stub = /^(\w+)Stub$/.exec(name);
      if (!stub) continue;
      // The channel it is given: one opened in the same function, else the file's only one.
      const here = fnOf(line);
      const near = channels.filter((c) => here && c.line >= here.start && c.line <= here.end);
      const ch = near.length === 1 ? near[0] : channels.length === 1 ? channels[0] : undefined;
      f.rpc.push({ service: stub[1], role: "calls", ...(ch ? { host: ch.host } : {}), line });
    }
  }

  // ── strings: SQL and hosts (docstrings skipped) ──
  const seen = new Set<string>();
  for (const s of root.descendantsOfType("string")) {
    if (s.parent?.type === "expression_statement") continue;
    const { text } = strText(s);
    const startLine = s.startPosition.row + 1;
    const lineOf = (off: number) => startLine + (text.slice(0, off).match(/\n/g)?.length ?? 0);
    for (const q of sqlInString(text, lineOf)) {
      const k = `${q.table}|${q.op}|${q.line}`;
      if (!seen.has(k)) {
        seen.add(k);
        f.sql.push(q);
      }
    }
    for (const c of sqlColumns(text, lineOf)) (f.columns ??= []).push(c);
    for (const sv of serviceFacts(text, startLine, "host")) f.services.push(sv);
  }

  return f;
}
