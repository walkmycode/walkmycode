// Facts from a Dart / Flutter file: imports, classes and functions, widgets
// (the ui layer), Dio and package:http requests, button triggers, local data
// (sqflite, Hive, Firestore, Supabase), String.fromEnvironment settings and
// the screens a router shows. This grammar has no call node: `api.get('/x')`
// is the identifier `api`, a selector `.get` and a selector holding the
// arguments, side by side. linkDart() then settles what one file can't see
// alone: the base URL a Dio client is given in another file, constants from
// an imported file, and which file holds each routed screen.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type ClientBaseFact, type ConstFact, type FileFacts, type HttpCallFact, type Method, type ScreenFact, type SqlFact } from "../facts";
import { asMethod, serviceFacts, serviceForEnv, serviceForPackage, sqlColumns, sqlInString } from "./common";

/** One call as the flat grammar spells it, with what comes before and after it. */
interface Call {
  /** "get", "GoRoute", "fromEnvironment" (a named constructor's own name: `FilledButton.icon` → "icon"). */
  name: string;
  /** Plain names before it: ["api"], ["widget", "apiClient"], ["FirebaseFirestore", "instance"]; [] for a bare call. */
  receiver: string[];
  /** Something before it is a call or an index (`ref.read(x).login()`): the receiver is no plain name. */
  complex: boolean;
  /** `const Text('x')` / `new Foo()`. */
  ctor: boolean;
  args: Node | null;
  /** Plain names read or called after it in the same chain: `.from('x').select()` → ["select"]. */
  after: string[];
  line: number;
  start: number;
  end: number;
  /** The node it is keyed by: the selector holding its arguments, the cascade section, or the const/new expression. */
  node: Node;
}

interface UrlText {
  url: string;
  fromVariable: boolean;
  varName?: string;
  literalBase?: string;
  baseIdent?: string;
}

type Val = { envVar?: string; literal?: string; ref?: string } | null;

/** Widgets whose subclasses draw the screen: a file with one is in the ui layer. */
const WIDGET_BASES = new Set(["StatelessWidget", "StatefulWidget", "ConsumerWidget", "ConsumerStatefulWidget", "HookWidget", "HookConsumerWidget", "StatefulHookWidget", "StatefulHookConsumerWidget", "State", "ConsumerState", "InheritedWidget"]);
/** Request methods by name; the verb-prefixed ones catch wrappers (`postMultipart`, `getList`). */
const HTTP_VERB = /^(get|post|put|patch|delete)(?:Uri|[A-Z]\w*)?$/;
const HTTP_OTHER = new Set(["request", "requestUri", "fetch", "download", "downloadUri"]);
const HANDLERS = new Set(["onPressed", "onTap", "onLongPress", "onDoubleTap", "onSubmitted", "onFieldSubmitted", "onChanged", "onSelected", "onRefresh", "onDestinationSelected"]);
const LABEL_ARGS = ["child", "label", "title", "text", "tooltip", "semanticLabel"];
const DB_RECEIVER = /(db|database|txn|transaction|batch)$/i;
const URLISH_RE = /^(?:https?:\/\/|wss?:\/\/|\/|[a-z0-9.-]+:\d+$)/i;
const URL_START = /^(\/|https?:\/\/|wss?:\/\/|\*)/;

function line(n: Node): number {
  return n.startPosition.row + 1;
}

/** `\n`, `\$`, `\u{1F600}` → the character. */
function unescape(e: string): string {
  const c = e[1];
  if (c === "n") return "\n";
  if (c === "t") return "\t";
  if (c === "r") return "\r";
  const u = /^\\u\{?([0-9a-fA-F]+)\}?$/.exec(e) ?? /^\\x([0-9a-fA-F]{2})$/.exec(e);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  return e.slice(1);
}

interface DartStr {
  text: string;
  /** The string begins with an interpolation (`'$baseUrl/x'`). */
  fromVariable: boolean;
  /** That first interpolation's expression. */
  lead?: Node[];
  /** File line of an offset in `text` (adjacent and multi-line strings keep their lines). */
  lineOf: (offset: number) => number;
}

/** A string literal's text with `hole` for each interpolation. Adjacent literals (`'a' 'b'`) join. */
function dartString(n: Node, src: string, hole = "*"): DartStr {
  let text = "";
  let inside = false;
  let pos = n.startIndex;
  let fromVariable = false;
  let lead: Node[] | undefined;
  const marks: { at: number; row: number }[] = [{ at: 0, row: n.startPosition.row }];
  for (const c of n.children) {
    if (!c.isNamed && /^r?(?:'''|"""|'|")$/.test(c.type)) {
      if (inside) text += src.slice(pos, c.startIndex);
      inside = !inside;
      pos = c.endIndex;
      if (inside) marks.push({ at: text.length, row: c.endPosition.row });
      continue;
    }
    if (!inside) continue;
    if (c.type === "template_substitution") {
      text += src.slice(pos, c.startIndex);
      if (text === "" && !fromVariable) {
        fromVariable = true;
        lead = c.namedChildren;
      }
      text += hole;
    } else if (c.type === "escape_sequence") text += src.slice(pos, c.startIndex) + unescape(c.text);
    else continue;
    pos = c.endIndex;
    marks.push({ at: text.length, row: c.endPosition.row });
  }
  const lineOf = (offset: number) => {
    let m = marks[0];
    for (const x of marks) if (x.at <= offset) m = x;
    return m.row + 1 + (text.slice(m.at, offset).match(/\n/g)?.length ?? 0);
  };
  return { text, fromVariable, lead, lineOf };
}

function labelOf(namedArg: Node): string | undefined {
  return namedArg.namedChildren[0]?.namedChildren[0]?.text;
}

/** The expression a container holds: an argument, a named argument (after its label), a declaration (after `=`). */
function exprOf(container: Node): Node[] {
  if (container.type === "named_argument") return container.namedChildren.slice(1);
  if (container.type === "argument") return container.namedChildren;
  const out: Node[] = [];
  let seen = false;
  for (const c of container.children) {
    if (seen && c.isNamed) out.push(c);
    if (c.type === "=") seen = true;
  }
  return out;
}

/** `await x`, `(x)` → x. */
function unwrap(seq: Node[]): Node[] {
  while (seq.length === 1 && (seq[0].type === "unary_expression" || seq[0].type === "await_expression" || seq[0].type === "parenthesized_expression")) seq = seq[0].namedChildren;
  return seq;
}

function positional(args: Node | null): Node[] {
  return args ? args.namedChildren.filter((c) => c.type === "argument") : [];
}

function named(args: Node | null, label: string): Node | undefined {
  return args?.namedChildren.find((c) => c.type === "named_argument" && labelOf(c) === label);
}

/** What a selector does: `.name` / `?.name`, a call, an index. */
function selectorKind(sel: Node): { kind: "name"; name: string } | { kind: "call" | "index" | "other" } {
  const c = sel.namedChildren[0];
  if (!c) return { kind: "other" };
  if (c.type === "argument_part") return { kind: "call" };
  if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector") {
    const id = c.namedChildren[0];
    return id?.type === "identifier" ? { kind: "name", name: id.text } : { kind: "index" };
  }
  return { kind: "other" };
}

/** Every call in the file: selector chains, cascades, `const`/`new` constructors, in source order. */
function collectCalls(root: Node): { calls: Call[]; at: Map<number, Call> } {
  const calls: Call[] = [];
  const at = new Map<number, Call>();
  const add = (c: Call) => {
    calls.push(c);
    at.set(c.node.id, c);
  };
  for (const n of root.descendantsOfType(["argument_part", "const_object_expression", "new_expression"])) {
    if (n.type !== "argument_part") {
      // const Text('x'), const EdgeInsets.all(8), new Foo.bar()
      const ids = n.namedChildren.filter((c) => c.type === "type_identifier" || c.type === "identifier");
      const type = ids[0]?.text;
      if (!type) continue;
      const own = ids[1]?.type === "identifier" ? ids[1].text : undefined;
      add({ name: own ?? type, receiver: own ? [type] : [], complex: false, ctor: true, args: n.namedChildren.find((c) => c.type === "arguments") ?? null, after: [], line: line(n), start: n.startIndex, end: n.endIndex, node: n });
      continue;
    }
    const holder = n.parent;
    if (!holder) continue;
    const args = n.namedChildren.find((c) => c.type === "arguments") ?? null;
    if (holder.type === "cascade_section") {
      // dio..get('/a')..post('/b')
      const sel = holder.namedChildren.find((c) => c.type === "cascade_selector");
      let prev = holder.previousSibling;
      while (prev && (prev.type === "cascade_section" || prev.type === "selector")) prev = prev.previousSibling;
      if (!sel) continue;
      const plain = prev?.type === "identifier";
      add({ name: sel.text, receiver: plain ? [prev!.text] : [], complex: !plain, ctor: false, args, after: [], line: line(holder), start: holder.startIndex, end: holder.endIndex, node: holder });
      continue;
    }
    if (holder.type !== "selector") continue;
    const before: Node[] = [];
    let prev = holder.previousSibling;
    while (prev && prev.type === "selector") {
      before.unshift(prev);
      prev = prev.previousSibling;
    }
    if (!prev || !prev.isNamed) continue;
    const kinds = before.map(selectorKind);
    let name: string;
    let receiverKinds = kinds;
    if (!kinds.length) {
      if (prev.type !== "identifier") continue;
      name = prev.text;
    } else {
      const last = kinds[kinds.length - 1];
      if (last.kind !== "name") continue;
      name = last.name;
      receiverKinds = kinds.slice(0, -1);
    }
    const head = prev.type === "identifier" || prev.type === "this" || prev.type === "super" ? prev.text : undefined;
    const receiver = kinds.length ? [head ?? "…", ...receiverKinds.map((k) => (k.kind === "name" ? k.name : "…"))] : [];
    const complex = receiver.includes("…");
    const after: string[] = [];
    for (let next = holder.nextSibling; next?.type === "selector"; next = next.nextSibling) {
      const k = selectorKind(next);
      if (k.kind === "name") after.push(k.name);
    }
    add({ name, receiver, complex, ctor: false, args, after, line: line(holder), start: prev.startIndex, end: holder.endIndex, node: holder });
  }
  calls.sort((a, b) => a.start - b.start || a.end - b.end);
  return { calls, at };
}

/** The call an expression ends in: `Uri.parse('x')`, `const Text('x')`. */
function callOf(seq: Node[], at: Map<number, Call>): Call | undefined {
  const u = unwrap(seq);
  const last = u[u.length - 1];
  if (!last) return undefined;
  if (last.type === "const_object_expression" || last.type === "new_expression") return at.get(last.id);
  if (last.type === "selector" && last.namedChildren[0]?.type === "argument_part") return at.get(last.id);
  return undefined;
}

/** "Text", "FilledButton" (for `FilledButton.icon(...)`), or undefined for a call that is no constructor. */
function widgetOf(c: Call): string | undefined {
  if (c.complex) return undefined;
  if (/^[A-Z]/.test(c.name) && c.receiver.length === 0) return c.name;
  const r = c.receiver[0];
  return c.receiver.length === 1 && /^[A-Z]/.test(r) ? r : undefined;
}

/** A plain word for the control a handler hangs on, so evidence reads "the 'Save' button". */
function elementWord(name: string): string {
  if (/^(InkWell|GestureDetector|InkResponse)$/.test(name)) return "tappable area";
  if (/menu_?item/i.test(name)) return "menu item";
  if (/tile$/i.test(name)) return "list item";
  if (/button|btn/i.test(name)) return "button";
  if (/chip$/i.test(name)) return "chip";
  if (/^(TextField|TextFormField|SearchBar|CupertinoTextField)$/.test(name)) return "text field";
  if (/^(Switch|Checkbox|Radio|Slider)$/.test(name)) return name.toLowerCase();
  if (name === "RefreshIndicator") return "pull-to-refresh";
  if (/NavigationBar|NavigationRail|TabBar/.test(name)) return "navigation bar";
  return name;
}

export function extractDart(root: Node, src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const { calls, at } = collectCalls(root);
  const isCtorCall = (c: Call) => c.ctor || (!c.receiver.length && /^[A-Z]/.test(c.name));
  /** Callee names in a span, as js.ts writes them ("api.get", "ref.read"). Widget constructors are left out, as JSX is. */
  const callsIn = (start: number, end: number): string[] => {
    const out = new Set<string>();
    for (const c of calls) {
      if (c.start < start || c.end > end || isCtorCall(c)) continue;
      const parts = c.receiver[0] === "this" ? c.receiver.slice(1) : c.receiver;
      out.add(c.complex || parts.length > 2 ? c.name : [...parts, c.name].join("."));
    }
    return [...out];
  };

  // ── imports, exports, parts ──
  for (const imp of root.descendantsOfType(["import_specification", "library_export", "part_directive"])) {
    const uri = imp.descendantsOfType("uri")[0]?.namedChildren[0];
    if (uri?.type !== "string_literal") continue;
    const spec = dartString(uri, src).text;
    const names: { local: string; imported: string }[] = [];
    if (imp.type === "import_specification") {
      const kids = imp.children;
      const as = kids.findIndex((c) => c.type === "as");
      if (as >= 0 && kids[as + 1]?.type === "identifier") names.push({ local: kids[as + 1].text, imported: "*" });
      for (const comb of imp.namedChildren.filter((c) => c.type === "combinator")) {
        if (comb.children[0]?.type !== "show") continue;
        for (const id of comb.namedChildren) if (id.type === "identifier") names.push({ local: id.text, imported: id.text });
      }
    }
    f.imports.push({ spec, names, line: line(imp) });
    const pkg = /^package:([^/]+)\//.exec(spec)?.[1];
    const svc = pkg ? serviceForPackage(pkg) : null;
    if (svc) f.services.push({ service: svc, line: line(imp), via: "sdk", text: spec });
  }

  // ── values: env reads, strings, constants (this file; linkDart follows imports) ──
  const valueOf = (seqIn: Node[], depth = 0): Val => {
    const seq = unwrap(seqIn);
    const n = seq[0];
    if (!n || depth > 3) return null;
    if (seq.length === 1) {
      if (n.type === "string_literal") {
        const s = dartString(n, src);
        return s.fromVariable || s.text.includes("*") ? null : { literal: s.text };
      }
      if (n.type === "identifier" || n.type === "identifier_dollar_escaped") {
        const c = f.consts[n.text];
        return c ? { envVar: c.envVar, literal: c.literal } : { ref: n.text };
      }
      if (n.type === "if_null_expression") {
        // String.fromEnvironment('X') ?? 'http://…', dotenv.env['X'] ?? '…'
        const l = valueOf(n.childrenForFieldName("first"), depth + 1);
        const r = valueOf(n.childrenForFieldName("second"), depth + 1);
        return l?.envVar || r?.literal ? { envVar: l?.envVar, literal: r?.literal ?? l?.literal } : null;
      }
    }
    const flat = seq.map((x) => x.text).join("").replace(/\s/g, "");
    const idx = /^(?:dotenv\.env|Platform\.environment)\[['"]([A-Za-z_]\w*)['"]\]$/.exec(flat);
    if (idx) return { envVar: idx[1] };
    if (n.type === "identifier" && /^[A-Z]/.test(n.text) && seq.length === 2 && seq[1].type === "selector") {
      // Env.baseUrl: a static constant, of this file or an imported one
      const k = selectorKind(seq[1]);
      if (k.kind === "name") {
        const ref = `${n.text}.${k.name}`;
        const c = f.consts[ref];
        return c ? { envVar: c.envVar, literal: c.literal } : { ref };
      }
    }
    const c = callOf(seq, at);
    return c ? envCall(c) : null;
  };
  /** String.fromEnvironment('X', defaultValue: '…'), dotenv.get('X', fallback: '…'). */
  const envCall = (c: Call): Val => {
    const r = c.receiver.join(".");
    const isEnv = c.name === "fromEnvironment" && /^(String|bool|int)$/.test(r);
    const isDotenv = r === "dotenv" && /^(get|maybeGet)$/.test(c.name);
    if (!isEnv && !isDotenv) return null;
    const first = positional(c.args)[0];
    const name = first ? valueOf(exprOf(first)) : null;
    if (!name?.literal) return null;
    const d = named(c.args, isEnv ? "defaultValue" : "fallback");
    const lit = d && (isDotenv || r === "String") ? valueOf(exprOf(d))?.literal : undefined;
    return { envVar: name.literal, ...(lit !== undefined ? { literal: lit } : {}) };
  };
  const keepConst = (name: string, value: Node[], at: number) => {
    const v = valueOf(value);
    if (!v) return;
    const literal = v.literal !== undefined && URLISH_RE.test(v.literal) ? v.literal : undefined;
    if (v.envVar || literal) f.consts[name] = { envVar: v.envVar, literal, line: at };
  };
  const declsOf = (list: Node) => list.namedChildren.filter((d) => d.type === "static_final_declaration" || d.type === "initialized_identifier");
  const isDeclList = (n: Node) => n.type === "static_final_declaration_list" || n.type === "initialized_identifier_list";
  // Top-level constants first, then each class's static ones (`Env.baseUrl`, and `baseUrl` inside the class).
  for (const list of root.namedChildren.filter(isDeclList)) {
    for (const d of declsOf(list)) {
      const name = d.namedChildren[0];
      if (name?.type === "identifier") keepConst(name.text, exprOf(d), line(d));
    }
  }
  for (const cls of root.namedChildren.filter((c) => c.type === "class_definition")) {
    const cname = cls.childForFieldName("name")?.text;
    const body = cls.childForFieldName("body");
    if (!cname || !body) continue;
    for (const decl of body.namedChildren.filter((c) => c.type === "declaration" && c.children.some((x) => x.type === "static"))) {
      for (const list of decl.namedChildren.filter(isDeclList)) {
        for (const d of declsOf(list)) {
          const name = d.namedChildren[0];
          if (name?.type !== "identifier") continue;
          keepConst(`${cname}.${name.text}`, exprOf(d), line(d));
          const c = f.consts[`${cname}.${name.text}`];
          if (c && !f.consts[name.text]) f.consts[name.text] = c;
        }
      }
    }
  }

  // ── classes and functions: classes and top-level functions are fns; methods and local functions are nested ──
  const top = root.namedChildren;
  for (let i = 0; i < top.length; i++) {
    const n = top[i];
    if (n.type === "class_definition" || n.type === "mixin_declaration" || n.type === "extension_declaration" || n.type === "enum_declaration") {
      const name = (n.childForFieldName("name") ?? n.namedChildren.find((c) => c.type === "identifier"))?.text;
      if (!name) continue;
      if (!name.startsWith("_")) f.exports.push(name);
      if (n.type !== "enum_declaration") f.fns.push({ name, start: line(n), end: n.endPosition.row + 1, calls: callsIn(n.startIndex, n.endIndex), exported: !name.startsWith("_") });
      const base = n.childForFieldName("superclass")?.namedChildren.find((c) => c.type === "type_identifier")?.text;
      if (base && WIDGET_BASES.has(base)) f.hasJsx = true;
    } else if ((n.type === "function_signature" || n.type === "getter_signature" || n.type === "setter_signature") && top[i + 1]?.type === "function_body") {
      const name = n.childForFieldName("name")?.text;
      const body = top[i + 1];
      if (!name) continue;
      f.fns.push({ name, start: line(n), end: body.endPosition.row + 1, calls: callsIn(body.startIndex, body.endIndex), exported: !name.startsWith("_") });
      if (!name.startsWith("_")) f.exports.push(name);
      // A function that builds a widget is UI too.
      if (n.namedChildren.some((c) => c.type === "type_identifier" && /^(Widget|PreferredSizeWidget)$/.test(c.text))) f.hasJsx = true;
    } else if (n.type === "type_alias") {
      const name = n.namedChildren.find((c) => c.type === "type_identifier")?.text;
      if (name && !name.startsWith("_")) f.exports.push(name);
    } else if (isDeclList(n)) {
      for (const d of declsOf(n)) {
        const name = d.namedChildren[0]?.text;
        if (!name) continue;
        if (!name.startsWith("_")) f.exports.push(name);
        // final usersProvider = FutureProvider((ref) async {...}): the closure is the function.
        if (d.descendantsOfType("function_expression").length) f.fns.push({ name, start: line(d), end: d.endPosition.row + 1, calls: callsIn(d.startIndex, d.endIndex), exported: !name.startsWith("_") });
      }
    }
  }
  // Methods (handlers live here: `onPressed: _save`), local functions, closures held in locals.
  for (const body of root.descendantsOfType(["class_body", "extension_body"])) {
    const kids = body.namedChildren;
    for (let i = 0; i < kids.length - 1; i++) {
      if (kids[i].type !== "method_signature" || kids[i + 1].type !== "function_body") continue;
      const name = kids[i].namedChildren[0]?.childForFieldName("name")?.text;
      if (name) f.nested.push({ name, start: line(kids[i]), end: kids[i + 1].endPosition.row + 1 });
    }
  }
  for (const lf of root.descendantsOfType("local_function_declaration")) {
    const name = lf.descendantsOfType("function_signature")[0]?.childForFieldName("name")?.text;
    if (name) f.nested.push({ name, start: line(lf), end: lf.endPosition.row + 1 });
  }
  for (const d of root.descendantsOfType("initialized_variable_definition")) {
    const name = d.childForFieldName("name")?.text;
    const value = d.childrenForFieldName("value");
    if (name && value.length === 1 && value[0].type === "function_expression") f.nested.push({ name, start: line(d), end: d.endPosition.row + 1 });
  }

  // ── settings: String.fromEnvironment, dotenv, Platform.environment ──
  const envRead = (name: string, at: number) => {
    f.envReads.push({ name, line: at });
    const svc = serviceForEnv(name);
    if (svc) f.services.push({ service: svc, line: at, via: "env", text: name });
  };
  for (const c of calls) {
    const v = envCall(c);
    if (v?.envVar) envRead(v.envVar, c.line);
  }
  for (const sel of root.descendantsOfType("index_selector")) {
    const holder = sel.parent?.parent;
    const s = sel.namedChildren[0];
    if (holder?.type !== "selector" || s?.type !== "string_literal") continue;
    let before = "";
    for (let p = holder.previousSibling; p; p = p.previousSibling) {
      before = p.text + before;
      if (p.type !== "selector") break;
    }
    if (/^(dotenv\.env|Platform\.environment)$/.test(before.replace(/\s/g, ""))) envRead(dartString(s, src).text, line(sel));
  }

  // ── requests: Dio, package:http, WebSockets, Retrofit ──
  /** The value a local of the enclosing function was given (`final url = Uri.parse(...)`). */
  const localValue = (name: string, node: Node): Node[] | null => {
    for (let p = node.parent; p; p = p.parent) {
      if (p.type !== "function_body" && p.type !== "function_expression_body") continue;
      const d = p.descendantsOfType("initialized_variable_definition").find((x) => x.childForFieldName("name")?.text === name && x.startIndex < node.startIndex);
      return d ? d.childrenForFieldName("value") : null;
    }
    return null;
  };
  const paramNamed = (list: Node | null | undefined, name: string) =>
    !!list?.descendantsOfType(["formal_parameter", "constructor_param"]).some((x) => (x.childForFieldName("name") ?? x.namedChildren.find((y) => y.type === "identifier"))?.text === name);
  /** Is this name a parameter, a local or a field where `node` is (so not a constant)? */
  const bound = (name: string, node: Node): boolean => {
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === "program") return false;
      if (p.type === "function_body" || p.type === "function_expression_body") {
        if (p.descendantsOfType("initialized_variable_definition").some((x) => x.childForFieldName("name")?.text === name)) return true;
        if (paramNamed(p.type === "function_body" ? p.previousSibling : null, name)) return true;
      }
      if (p.type === "function_expression" && paramNamed(p.childForFieldName("parameters"), name)) return true;
      if (p.type === "class_body") {
        const field = p.descendantsOfType(["initialized_identifier", "static_final_declaration"]).some((x) => x.namedChildren[0]?.text === name);
        if (field && !f.consts[name]) return true;
      }
    }
    return false;
  };
  /** A public, constant-looking name the URL leans on that this file does not bind: linkDart
   * looks for it in the files this one imports (a private `_name` can't come from one). */
  const refOf = (v: Val, node: Node): string | undefined => {
    if (!v?.ref || v.envVar || v.literal !== undefined) return undefined;
    if (!/^[A-Z]\w*\.[a-zA-Z]\w*$|^[a-zA-Z]\w*$/.test(v.ref) || bound(v.ref.split(".")[0], node)) return undefined;
    return v.ref;
  };
  /** A request's URL. `names`: a bare constant name may stand for the whole URL (not for a wrapper's
   * own argument, where `prefs.getString(kKey)` would read as a request). */
  const urlOf = (seqIn: Node[], depth = 0, names = true): UrlText | null => {
    const seq = unwrap(seqIn);
    const n = seq[0];
    if (!n || depth > 3) return null;
    if (seq.length === 1 && n.type === "string_literal") {
      const s = dartString(n, src);
      const out: UrlText = { url: s.text, fromVariable: s.fromVariable };
      if (s.lead) {
        const v = valueOf(s.lead);
        // '$_basePath/sessions' with _basePath = '/api/v1/chat': still a path, so the client's base applies.
        if (v?.literal !== undefined && !v.envVar && v.literal.startsWith("/")) return { url: v.literal.replace(/\/$/, "") + s.text.slice(1), fromVariable: false };
        if (v?.envVar) out.varName = v.envVar;
        if (v?.literal !== undefined && URLISH_RE.test(v.literal)) out.literalBase = v.literal;
        const ref = refOf(v, n);
        if (ref) out.baseIdent = ref;
      }
      return out;
    }
    if (seq.length === 1 && n.type === "additive_expression") {
      // baseUrl + '/path'
      const kids = n.namedChildren.filter((c) => c.type !== "additive_operator");
      const l = kids[0] ? urlOf([kids[0]], depth + 1) : null;
      const r = kids[1] ? urlOf(kids.slice(1), depth + 1) : null;
      const out: UrlText = { url: (l?.url ?? "*") + (r?.url ?? "*"), fromVariable: !l || l.fromVariable };
      if (l?.varName) out.varName = l.varName;
      if (l?.literalBase !== undefined) out.literalBase = l.literalBase;
      if (l?.baseIdent) out.baseIdent = l.baseIdent;
      return out;
    }
    const plainName = seq.length === 1 && (n.type === "identifier" || n.type === "identifier_dollar_escaped");
    if (plainName) {
      const local = localValue(n.text, n);
      if (local) return urlOf(local, depth + 1);
    }
    const c = callOf(seq, at);
    if (c && c.receiver.join(".") === "Uri" && (c.name === "parse" || c.name === "tryParse")) {
      const first = positional(c.args)[0];
      return first ? urlOf(exprOf(first), depth + 1) : null;
    }
    if (c && c.receiver.join(".") === "Uri" && (c.name === "https" || c.name === "http")) {
      // Uri.https('api.example.com', '/v1/items')
      const [host, path] = positional(c.args).map((a) => urlOf(exprOf(a), depth + 1));
      return host && !host.fromVariable ? { url: `${c.name}://${host.url}${path?.url ?? ""}`, fromVariable: false } : null;
    }
    if (names && (plainName || (seq.length === 2 && n.type === "identifier"))) {
      // api.get(Endpoints.bookings), http.get(Uri.parse(kApiUrl)): a constant, here or imported
      const v = valueOf(seq);
      if (v?.literal !== undefined) return { url: v.literal, fromVariable: false };
      if (v?.envVar) return { url: "*", fromVariable: true, varName: v.envVar };
      const ref = refOf(v, n);
      return ref ? { url: "*", fromVariable: true, baseIdent: ref } : null;
    }
    return null;
  };
  const methodFromOptions = (args: Node | null): Method | undefined => {
    const opts = named(args, "options");
    const c = opts ? callOf(exprOf(opts), at) : undefined;
    const m = c?.name === "Options" ? named(c.args, "method") : undefined;
    return asMethod(m ? valueOf(exprOf(m))?.literal : undefined);
  };
  const pushHttp = (c: Call, u: UrlText, method: Method | undefined) => {
    const parts = c.receiver[0] === "this" ? c.receiver.slice(1) : c.receiver;
    const h: HttpCallFact = { url: u.url, method, line: c.line, callee: !parts.length ? c.name : `${c.complex ? "…" : parts.join(".")}.${c.name}`, fromVariable: u.fromVariable };
    if (u.varName) h.varName = u.varName;
    if (u.literalBase !== undefined) h.literalBase = u.literalBase;
    if (u.baseIdent) h.baseIdent = u.baseIdent;
    f.http.push(h);
  };
  // shelf_router's router.get('/x', handler) defines a route; it is no request.
  const serverRouter = f.imports.some((i) => /^package:(shelf_router|dart_frog)\//.test(i.spec));
  for (const c of calls) {
    const recv = c.receiver.join(".");
    const verb = HTTP_VERB.exec(c.name);
    const pos = positional(c.args);
    if (verb || HTTP_OTHER.has(c.name) || (recv === "http" && (c.name === "read" || c.name === "readBytes"))) {
      if (c.ctor || (!c.receiver.length && !/^(get|post|put|patch|delete)$/.test(c.name))) continue;
      if (unwrap(pos[1] ? exprOf(pos[1]) : [])[0]?.type === "function_expression" || (serverRouter && /router|app/i.test(recv))) continue;
      const u = pos[0] ? urlOf(exprOf(pos[0]), 0, !verb || verb[0] === verb[1]) : null;
      if (!u || !URL_START.test(u.url)) continue;
      const method = verb ? asMethod(verb[1]) : /^download|^read/.test(c.name) ? "GET" : methodFromOptions(c.args);
      pushHttp(c, u, method);
    } else if ((c.name === "Request" || c.name === "MultipartRequest" || c.name === "StreamedRequest") && (!c.receiver.length || recv === "http")) {
      // http.Request('POST', uri)
      const u = pos[1] ? urlOf(exprOf(pos[1])) : null;
      if (u && URL_START.test(u.url)) pushHttp(c, u, asMethod(pos[0] ? valueOf(exprOf(pos[0]))?.literal : undefined));
    } else if (c.name === "connect" && /WebSocketChannel$/.test(recv)) {
      // WebSocketChannel.connect(Uri.parse('wss://…'))
      const u = pos[0] ? urlOf(exprOf(pos[0])) : null;
      if (u && URL_START.test(u.url)) pushHttp(c, u, "GET");
    }
  }
  // Retrofit: @GET('/tasks') on a method of a @RestApi class.
  for (const ann of root.descendantsOfType("annotation")) {
    const name = ann.childForFieldName("name")?.text ?? "";
    const arg = ann.descendantsOfType("argument")[0];
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(name) || !arg) continue;
    const u = urlOf(exprOf(arg));
    if (u && URL_START.test(u.url)) f.http.push({ url: u.url, method: name as Method, line: line(ann), callee: `@${name}`, fromVariable: u.fromVariable, ...(u.varName ? { varName: u.varName } : {}) });
  }

  // ── base URLs given to an HTTP client: Dio BaseOptions(baseUrl:), dio.options.baseUrl =, @RestApi(baseUrl:) ──
  // Kept even when nothing can be told about one: an unknown base stops linkDart guessing for the package.
  const bases: ClientBaseFact[] = [];
  const addBase = (value: Node[], at: number) => {
    const v = valueOf(value);
    const b: ClientBaseFact = { line: at };
    if (v?.envVar) b.envVar = v.envVar;
    if (v?.literal !== undefined && URLISH_RE.test(v.literal)) b.literal = v.literal;
    const ref = value[0] ? refOf(v, value[0]) : undefined;
    if (ref) b.ref = ref;
    bases.push(b);
  };
  for (const c of calls) {
    const b = c.name === "BaseOptions" || c.name === "RestApi" ? named(c.args, "baseUrl") : undefined;
    if (b) addBase(exprOf(b), line(b));
  }
  for (const ann of root.descendantsOfType("annotation")) {
    if (ann.childForFieldName("name")?.text !== "RestApi") continue;
    const b = ann.descendantsOfType("named_argument").find((x) => labelOf(x) === "baseUrl");
    if (b) addBase(exprOf(b), line(b));
  }
  for (const asg of root.descendantsOfType("assignment_expression")) {
    const left = asg.childForFieldName("left")?.text.replace(/\s/g, "") ?? "";
    if (/(^|\.)options\.baseUrl$/.test(left)) addBase(asg.childrenForFieldName("right"), line(asg));
  }
  if (bases.length) f.clientBases = bases;

  // ── triggers: onPressed / onTap on a widget, labelled by its Text, label or tooltip ──
  const textIn = (seq: Node[]): string | undefined => {
    const u = unwrap(seq);
    if (u.length === 1 && u[0].type === "string_literal") return dartString(u[0], src, "…").text;
    if (!seq.length) return undefined;
    const t = calls.find((c) => (c.name === "Text" || c.name === "Tab") && c.start >= seq[0].startIndex && c.end <= seq[seq.length - 1].endIndex);
    const arg = t?.name === "Tab" ? named(t.args, "text") : t ? positional(t.args)[0] : undefined;
    const s = arg ? unwrap(exprOf(arg)) : [];
    return s.length === 1 && s[0].type === "string_literal" ? dartString(s[0], src, "…").text : undefined;
  };
  const labelFor = (c: Call, widget: string | undefined): string | undefined => {
    if (widget === "RefreshIndicator") return undefined;
    for (const l of LABEL_ARGS) {
      const a = named(c.args, l);
      const t = a ? textIn(exprOf(a)) : undefined;
      if (t) return t;
    }
    // TextField(decoration: InputDecoration(labelText: 'Email'))
    const deco = named(c.args, "decoration");
    const d = deco ? callOf(exprOf(deco), at) : undefined;
    for (const l of ["labelText", "hintText"]) {
      const a = d ? named(d.args, l) : undefined;
      const t = a ? textIn(exprOf(a)) : undefined;
      if (t) return t;
    }
    // A helper of the app's own (`_menuItem(Icons.add, 'Services', onTap: ...)`): its first string.
    if (!widget) for (const p of positional(c.args)) {
      const t = textIn(exprOf(p));
      if (t) return t;
    }
    return undefined;
  };
  const handlerOf = (seqIn: Node[]): { handler: string; range?: [number, number] } | null => {
    const seq = unwrap(seqIn);
    const n = seq[0];
    if (!n) return null;
    if (seq.length === 1 && n.type === "identifier") return { handler: n.text };
    if (seq.length === 1 && n.type === "function_expression") {
      // () => _submit(): the arrow just calls a named handler
      const names = callsIn(n.startIndex, n.endIndex);
      return { handler: names.length === 1 ? names[0] : "inline", range: [line(n), n.endPosition.row + 1] };
    }
    if (seq.length === 1 && n.type === "conditional_expression") {
      // busy ? null : _submit
      const kids = n.children;
      for (const k of kids.slice(kids.findIndex((c) => c.type === "?") + 1)) {
        if (!k.isNamed || k.type === "null_literal") continue;
        const h = handlerOf([k]);
        if (h) return h;
      }
      return null;
    }
    if (n.type === "identifier" && seq.every((x, i) => i === 0 || selectorKind(x).kind === "name")) return { handler: seq.map((x) => x.text).join("") };
    return null;
  };
  for (const c of calls) {
    for (const arg of c.args?.namedChildren ?? []) {
      if (arg.type !== "named_argument" || !HANDLERS.has(labelOf(arg) ?? "")) continue;
      const h = handlerOf(exprOf(arg));
      if (!h) continue;
      const widget = widgetOf(c);
      const label = labelFor(c, widget)?.trim().slice(0, 60);
      f.triggers.push({ element: elementWord(widget ?? c.name.replace(/^_+/, "")), ...(label ? { label } : {}), handler: h.handler, line: line(arg), ...(h.range ? { range: h.range } : {}) });
    }
  }

  // ── data: sqflite helpers, Hive boxes, Firestore collections, Supabase tables ──
  const firestore = f.imports.some((i) => /^package:cloud_firestore\//.test(i.spec));
  const tableArg = (c: Call): string | undefined => {
    const first = positional(c.args)[0];
    const v = first ? valueOf(exprOf(first)) : null;
    return v?.literal !== undefined && /^[A-Za-z_][\w-]*$/.test(v.literal) ? v.literal : undefined;
  };
  const sqlPush = (q: SqlFact) => {
    if (!f.sql.some((x) => x.table === q.table && x.op === q.op && x.line === q.line)) f.sql.push(q);
  };
  for (const c of calls) {
    const recv = c.receiver[c.receiver.length - 1] ?? "";
    let op: SqlFact["op"] | undefined;
    if (!c.complex && DB_RECEIVER.test(recv) && /^(query|insert|update|delete)$/.test(c.name)) op = c.name === "query" ? "read" : "write";
    else if (c.receiver.join(".") === "Hive" && /^(openBox|openLazyBox|box|lazyBox)$/.test(c.name)) op = c.name.startsWith("open") ? "define" : "read";
    else if (firestore && (c.name === "collection" || c.name === "collectionGroup")) op = c.after.some((x) => /^(add|set|update|delete)$/.test(x)) ? "write" : "read";
    // supabase.from('bookings').select() / .insert()
    else if (c.name === "from" && c.receiver.length) op = c.after.some((x) => /^(insert|update|upsert|delete)$/.test(x)) ? "write" : c.after.includes("select") ? "read" : undefined;
    const t = op ? tableArg(c) : undefined;
    if (op && t) sqlPush({ table: t, op, line: c.line });
  }
  // SQL in any string (sqflite rawQuery / execute), and the hosts strings name.
  for (const s of root.descendantsOfType("string_literal")) {
    if (s.parent?.type === "uri") continue;
    const str = dartString(s, src, "?");
    for (const q of sqlInString(str.text, str.lineOf)) sqlPush(q);
    for (const c of sqlColumns(str.text, str.lineOf)) (f.columns ??= []).push(c);
    for (const sv of serviceFacts(str.text, line(s), "host")) f.services.push(sv);
  }

  // ── screens: GoRoute(path: '/x', builder: ... => XScreen()), MaterialApp(routes: {'/x': (c) => XScreen()}) ──
  /** The widget a builder returns, through a page wrapper (`NoTransitionPage(child: X())`). */
  const screenOf = (fn: Node): string | undefined => {
    const body = fn.childForFieldName("body");
    const block = body?.namedChildren.find((c) => c.type === "block");
    const seq = block ? (block.descendantsOfType("return_statement")[0]?.namedChildren ?? []) : (body?.namedChildren ?? []);
    const c = callOf(seq, at);
    const w = c ? widgetOf(c) : undefined;
    // NoTransitionPage(child: X()) wraps the screen; a screen may be called HomePage itself.
    const child = c && w && /Page$/.test(w) ? named(c.args, "child") : undefined;
    if (!child) return w;
    const inner = callOf(exprOf(child), at);
    return inner ? widgetOf(inner) : undefined;
  };
  const pathOf = (seq: Node[]): string | undefined => {
    const v = valueOf(seq);
    return v?.literal ?? (v?.ref ? `{${v.ref}}` : undefined);
  };
  /** The call whose arguments these are. */
  const ownerCall = (args: Node): Call | undefined => {
    const p = args.parent;
    if (p?.type === "const_object_expression" || p?.type === "new_expression") return at.get(p.id);
    return p?.parent ? at.get(p.parent.id) : undefined;
  };
  /** The GoRoute whose `routes:` list holds this one, if any. */
  const parentRoute = (c: Call): Call | undefined => {
    for (let p = c.node.parent; p; p = p.parent) {
      if (p.type !== "named_argument" || labelOf(p) !== "routes") continue;
      const owner = p.parent?.type === "arguments" ? ownerCall(p.parent) : undefined;
      return owner?.name === "GoRoute" ? owner : undefined;
    }
    return undefined;
  };
  const fullPath = (c: Call, depth = 0): string | undefined => {
    const p = named(c.args, "path");
    const own = p ? pathOf(exprOf(p)) : undefined;
    if (own === undefined || depth > 8) return undefined;
    if (own.startsWith("/")) return own;
    const parent = parentRoute(c);
    const up = parent ? fullPath(parent, depth + 1) : undefined;
    if (up === undefined) return own.startsWith("{") ? own : `/${own}`;
    return `${up.replace(/\/$/, "")}/${own}`;
  };
  const screens: ScreenFact[] = [];
  for (const c of calls) {
    if (c.name === "GoRoute" && !c.receiver.length) {
      const b = named(c.args, "builder") ?? named(c.args, "pageBuilder");
      const fn = b ? unwrap(exprOf(b))[0] : undefined;
      const widget = fn?.type === "function_expression" ? screenOf(fn) : undefined;
      const path = widget ? fullPath(c) : undefined;
      if (widget && path) screens.push({ path, widget, line: c.line });
    } else if (/^(MaterialApp|CupertinoApp|WidgetsApp)$/.test(widgetOf(c) ?? "")) {
      const routes = named(c.args, "routes");
      const map = routes ? unwrap(exprOf(routes))[0] : undefined;
      for (const pair of map?.type === "set_or_map_literal" ? map.namedChildren.filter((x) => x.type === "pair") : []) {
        const key = pair.childForFieldName("key");
        const value = pair.childForFieldName("value");
        const path = key ? pathOf([key]) : undefined;
        const widget = value?.type === "function_expression" ? screenOf(value) : undefined;
        if (path && widget) screens.push({ path, widget, line: line(pair) });
      }
    }
  }
  if (screens.length) f.screens = screens;
  return f;
}

export interface DartScreen {
  /** The file whose widget is shown. */
  file: string;
  paths: string[];
  /** Where the router says so. */
  at: { file: string; line: number };
}

/** What no Dart file can see alone, settled across its package once every
 * file is parsed and its imports resolved (the facts are changed in place):
 * - a relative request (`api.get('/x')`) goes to the base URL the package's
 *   Dio clients are given, when they are given exactly one (the file's own
 *   clients first); it then reads as `'$BASE/x'` would;
 * - a URL that starts with a constant from an imported file (`ApiConfig.baseUrl`);
 * - the file each routed screen's widget is in, returned for its card.
 * `packageOf` names a file's package (its area); `importsOf` lists the files it imports. */
export function linkDart(facts: Record<string, FileFacts>, packageOf: (p: string) => string, importsOf: (p: string) => string[]): DartScreen[] {
  const dart = Object.keys(facts).filter((p) => p.endsWith(".dart"));
  /** A constant by name: this file's, then an imported file's, then one a barrel it imports re-exports. */
  const constOf = (p: string, ref: string): ConstFact | undefined => {
    const own = facts[p]?.consts[ref];
    if (own) return own;
    if (/^_|\._/.test(ref)) return undefined; // private to its own file
    const seen = new Set([p]);
    let level = importsOf(p);
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const q of level) {
        if (seen.has(q) || !facts[q]) continue;
        seen.add(q);
        const c = facts[q].consts[ref];
        if (c) return c;
        next.push(...importsOf(q));
      }
      level = next;
    }
    return undefined;
  };
  const known = (b: ClientBaseFact) => b.envVar !== undefined || b.literal !== undefined;
  const key = (b: ClientBaseFact) => `${b.envVar ?? ""}|${b.literal ?? ""}`;
  /** The one base, when every client is given a known one and they agree. */
  const oneOf = (bases: ClientBaseFact[]): ClientBaseFact | undefined => (bases.length && bases.every(known) && new Set(bases.map(key)).size === 1 ? bases[0] : undefined);

  const byPackage = new Map<string, ClientBaseFact[]>();
  for (const p of dart) {
    for (const b of facts[p].clientBases ?? []) {
      if (!known(b) && b.ref) {
        const c = constOf(p, b.ref);
        if (c?.envVar) b.envVar = c.envVar;
        if (c?.literal !== undefined) b.literal = c.literal;
      }
      byPackage.set(packageOf(p), [...(byPackage.get(packageOf(p)) ?? []), b]);
    }
  }
  for (const p of dart) {
    const own = facts[p].clientBases ?? [];
    const base = own.length ? oneOf(own) : oneOf(byPackage.get(packageOf(p)) ?? []);
    for (const h of facts[p].http) {
      if (h.fromVariable && !h.varName && h.literalBase === undefined && h.baseIdent) {
        const c = constOf(p, h.baseIdent);
        if (c?.envVar) h.varName = c.envVar;
        if (c?.literal !== undefined && !c.envVar && c.literal.startsWith("/")) {
          // Endpoints.bookings = '/api/v1/bookings': the URL is that path and the rest.
          h.url = c.literal.replace(/\/$/, "") + h.url.slice(1);
          h.fromVariable = false;
        } else if (c?.literal !== undefined) h.literalBase = c.literal;
      }
      if (base && !h.fromVariable && h.url.startsWith("/") && !/^http\./.test(h.callee)) {
        h.url = `*${h.url}`;
        h.fromVariable = true;
        if (base.envVar) h.varName = base.envVar;
        if (base.literal !== undefined) h.literalBase = base.literal;
      }
    }
    // A request whose whole URL was a name that never turned out to be a URL is no request we can place.
    facts[p].http = facts[p].http.filter((h) => !(h.url === "*" && !h.varName && h.literalBase === undefined));
  }

  // Screens: the file holding the class the router's builder returns.
  const defines = (q: string, cls: string) => facts[q]?.fns.some((x) => x.name === cls) ?? false;
  const out = new Map<string, DartScreen>();
  for (const p of dart) {
    for (const s of facts[p].screens ?? []) {
      let unknown = false;
      const path = s.path
        .replace(/\{([^}]+)\}/g, (_, ref: string) => {
          const c = constOf(p, ref);
          if (c?.literal === undefined) unknown = true;
          return c?.literal ?? "";
        })
        .replace(/\/{2,}/g, "/");
      // A screen kept in the router's own file is left alone: that card is the router's.
      if (unknown || defines(p, s.widget)) continue;
      const imported = importsOf(p).filter((q) => defines(q, s.widget));
      const files = imported.length ? imported : dart.filter((q) => q !== p && packageOf(q) === packageOf(p) && defines(q, s.widget));
      if (files.length !== 1) continue;
      const hit = out.get(files[0]) ?? { file: files[0], paths: [], at: { file: p, line: s.line } };
      if (!hit.paths.includes(path)) hit.paths.push(path);
      out.set(files[0], hit);
    }
  }
  return [...out.values()];
}
