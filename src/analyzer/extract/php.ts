// Facts from a PHP file, Laravel first: `use` imports, classes and their
// methods, Route:: registrations (closures, [Controller::class, 'method'],
// 'Controller@method', resources, groups with a prefix), Eloquent calls on a
// class that may be a model, DB::table(), migrations' Schema::create() with
// their columns, view() and Inertia::render(), Http:: requests, env() reads
// and SQL in strings; Blade forms and links, Livewire's <livewire:x /> and
// wire:click. Symfony: #[Route] attributes, Doctrine entities (#[ORM\Entity],
// #[ORM\Column]) and the calls that read and write them, $this->render() of a
// Twig template (extractTwig reads the template). One file can't tell a model from any other class, nor
// which file a class lives in: linkPhp() settles that once every file is
// parsed, from composer.json's PSR-4 map and the classes the files declare.
import type { Node } from "web-tree-sitter";
import { emptyFacts, type FileFacts, type HttpCallFact, type Method, type PhpFacts, type RouteFact, type SqlFact } from "../facts";
import { serviceFacts, serviceForEnv, sqlColumns, sqlInString } from "./common";

function line(n: Node): number {
  return n.startPosition.row + 1;
}
function endLine(n: Node): number {
  return n.endPosition.row + 1;
}

/** PHP SDKs by namespace → the outside service (composer packages have no import spec to look up). */
const NAMESPACE_SERVICES: [RegExp, string][] = [
  [/^Stripe\\/, "Stripe"],
  [/^Laravel\\Cashier\\/, "Stripe"],
  [/^OpenAI\\|^OpenAI$/, "OpenAI"],
  [/^Anthropic\\/, "Anthropic (Claude)"],
  [/^Twilio\\/, "Twilio"],
  [/^Aws\\/, "AWS"],
  [/^Kreait\\Firebase\\/, "Firebase"],
  [/^Resend\\|^Resend$/, "Resend (email)"],
  [/^SendGrid\\|^SendGrid$/, "SendGrid (email)"],
  [/^Pusher\\/, "Pusher"],
  [/^Algolia\\/, "Algolia"],
  [/^Mailgun\\/, "Mailgun"],
  [/^Postmark\\/, "Postmark"],
  [/^Sentry\\/, "Sentry"],
  [/^Cloudinary\\/, "Cloudinary"],
  [/^Google\\Cloud\\/, "Google APIs"],
  [/^Gemini\\/, "Google Gemini"],
];

/** Eloquent calls that change rows; on a model class or an instance of one. */
const MODEL_WRITE = new Set(["create", "createQuietly", "forceCreate", "createMany", "insert", "insertOrIgnore", "insertGetId", "update", "updateQuietly", "updateOrCreate", "updateOrInsert", "firstOrCreate", "upsert", "delete", "deleteQuietly", "destroy", "forceDelete", "restore", "save", "saveQuietly", "saveMany", "push", "increment", "decrement", "truncate", "touch"]);
/** Eloquent calls that only read (or start a query a later call may turn into a write). */
const MODEL_READ = new Set(["all", "find", "findOrFail", "findMany", "findOr", "first", "firstOrFail", "firstOr", "firstWhere", "firstOrNew", "get", "query", "paginate", "simplePaginate", "cursorPaginate", "count", "exists", "doesntExist", "pluck", "latest", "oldest", "orderBy", "orderByDesc", "with", "withCount", "select", "has", "whereHas", "doesntHave", "sum", "avg", "max", "min", "chunk", "cursor", "lazy", "value", "sole", "limit", "take", "withTrashed", "onlyTrashed", "factory", "refresh", "fresh", "load"]);
/** Doctrine repository calls that read: on a repository, or a repository's own `$this->...`. */
const REPO_READ = new Set(["find", "findAll", "findBy", "findOneBy", "count", "createQueryBuilder", "matching"]);
const isQuery = (m: string) => MODEL_READ.has(m) || MODEL_WRITE.has(m) || /^(where|orWhere)/.test(m);
/** Classes whose static calls are Laravel's own facades, never a model. */
const FACADES = new Set(["Route", "DB", "Schema", "Http", "Cache", "Log", "Auth", "Session", "Storage", "Mail", "Queue", "Event", "Gate", "Hash", "Validator", "View", "Inertia", "Str", "Arr", "Config", "App", "Artisan", "Bus", "Notification", "Redirect", "Request", "Response", "URL", "Cookie", "Crypt", "Lang", "Password", "RateLimiter", "Vite", "Blade", "Broadcast", "Carbon", "self", "static", "parent"]);
const ROUTE_VERBS: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", options: "ANY", any: "ANY" };
const HTTP_VERBS: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE", head: "GET" };
/** A resource controller's actions, in Laravel's order; apiResource leaves out the two form pages. */
const RESOURCE_ACTIONS: { action: string; methods: Method[]; suffix: (param: string) => string }[] = [
  { action: "index", methods: ["GET"], suffix: () => "" },
  { action: "create", methods: ["GET"], suffix: () => "/create" },
  { action: "store", methods: ["POST"], suffix: () => "" },
  { action: "show", methods: ["GET"], suffix: (p) => `/{${p}}` },
  { action: "edit", methods: ["GET"], suffix: (p) => `/{${p}}/edit` },
  // Laravel answers both PUT and PATCH here; each gets a card so a request with either finds it.
  { action: "update", methods: ["PUT", "PATCH"], suffix: (p) => `/{${p}}` },
  { action: "destroy", methods: ["DELETE"], suffix: (p) => `/{${p}}` },
];
/** Blueprint calls that are no column (indexes, keys, table options, drops). */
const NOT_COLUMNS = new Set(["index", "unique", "primary", "foreign", "spatialIndex", "fullText", "rawIndex", "dropColumn", "dropColumns", "renameColumn", "dropForeign", "dropIndex", "dropUnique", "dropPrimary", "dropTimestamps", "dropSoftDeletes", "dropConstrainedForeignId", "dropForeignIdFor", "dropMorphs", "dropRememberToken", "engine", "charset", "collation", "comment", "temporary", "after", "first"]);

/** Livewire directives whose value names no method: a property, a key, what to show while loading. */
const WIRE_NOT_ACTIONS = new Set(["model", "key", "loading", "target", "ignore", "dirty", "offline", "transition", "navigate", "stream", "replace", "show", "text", "cloak", "current", "confirm"]);

/** Laravel's table name for a model class: snake case, last word plural (Todo → todos, UserProfile → user_profiles). */
export function tableNameOf(cls: string): string {
  const words = snake(cls).split("_");
  words[words.length - 1] = plural(words[words.length - 1]);
  return words.join("_");
}

function snake(cls: string): string {
  return cls.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

const IRREGULAR: Record<string, string> = { person: "people", man: "men", woman: "women", child: "children", foot: "feet", tooth: "teeth", mouse: "mice", goose: "geese" };
const UNCOUNTED = new Set(["equipment", "information", "rice", "money", "species", "series", "fish", "sheep", "deer", "news", "data", "media", "feedback", "staff", "metadata"]);

function plural(w: string): string {
  if (UNCOUNTED.has(w)) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  return `${w}s`;
}

/** A resource's route parameter: Laravel singularises the last word (photos → photo, categories → category). */
function singular(w: string): string {
  const s = w.replace(/-/g, "_");
  const irr = Object.entries(IRREGULAR).find(([, p]) => p === s);
  if (irr) return irr[0];
  if (/ies$/.test(s)) return `${s.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(s)) return s.slice(0, -2);
  if (/s$/.test(s) && !/ss$/.test(s)) return s.slice(0, -1);
  return s;
}

function joinUri(prefix: string, uri: string): string {
  const p = `/${[prefix, uri].join("/")}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return p || "/";
}

/** A single-quoted or double-quoted string's text, `*` for each interpolated piece;
 * null for anything else. `lead` says the string starts with an interpolation. */
function strOf(n: Node | null | undefined): { text: string; lead: boolean } | null {
  if (!n) return null;
  if (n.type === "string" || n.type === "encapsed_string" || n.type === "heredoc" || n.type === "nowdoc") {
    let text = "";
    let lead = false;
    let first = true;
    const walk = (c: Node) => {
      if (c.type === "string_content" || c.type === "string_value") text += c.text;
      else if (c.type === "escape_sequence") text += c.text.length === 2 ? c.text[1] : c.text;
      else if (c.type === "heredoc_body" || c.type === "nowdoc_body") {
        for (const x of c.children) walk(x);
        return;
      } else if (c.isNamed && !/^(heredoc_start|heredoc_end|nowdoc_start|nowdoc_end)$/.test(c.type)) {
        if (first) lead = true;
        text += "*";
      } else return;
      first = false;
    };
    for (const c of n.children) walk(c);
    return { text, lead };
  }
  return null;
}

/** The string an argument holds, when it is a plain one. */
function strArg(n: Node | null | undefined): string | undefined {
  const s = strOf(n);
  return s && !s.text.includes("*") ? s.text : undefined;
}

/** An `arguments` node's argument expressions (each `argument` unwrapped); named arguments keep their name.
 * A call's, or an attribute's (`#[Route('/x', name: 'y')]`). */
function argsOf(call: Node): { name?: string; value: Node }[] {
  const args = call.type === "attribute" ? call.namedChildren.find((x) => x.type === "arguments") : call.childForFieldName("arguments");
  const out: { name?: string; value: Node }[] = [];
  for (const a of args?.namedChildren ?? []) {
    if (a.type !== "argument") continue;
    const name = a.childForFieldName("name")?.text;
    const value = a.namedChildren[a.namedChildren.length - 1];
    if (value) out.push(name ? { name, value } : { value });
  }
  return out;
}

/** The callee's name: `get` of `Route::get(...)`, `save` of `$todo->save()`, `view` of `view(...)`. */
function callName(call: Node): string | undefined {
  if (call.type === "function_call_expression") return call.childForFieldName("function")?.text;
  return call.childForFieldName("name")?.text;
}

const isCall = (n: Node | null | undefined): n is Node => !!n && (n.type === "member_call_expression" || n.type === "nullsafe_member_call_expression" || n.type === "scoped_call_expression");

/** A fluent chain from its first call: `Route::prefix('x')->group(...)` → [prefix, group]. Null when it
 * does not start with a static call. */
function chainOf(n: Node): Node[] | null {
  if (n.type === "scoped_call_expression") return [n];
  if (n.type === "member_call_expression" || n.type === "nullsafe_member_call_expression") {
    const obj = n.childForFieldName("object");
    const inner = obj && isCall(obj) ? chainOf(obj) : null;
    return inner ? [...inner, n] : null;
  }
  return null;
}

/** The calls made on what `n` returns: `Todo::where(...)` → [where, update] in `Todo::where(...)->update()`. */
function callsAfter(n: Node): string[] {
  const out: string[] = [];
  let cur = n;
  for (let p = cur.parent; p && (p.type === "member_call_expression" || p.type === "nullsafe_member_call_expression") && p.childForFieldName("object")?.id === cur.id; p = p.parent) {
    const name = callName(p);
    if (name) out.push(name);
    cur = p;
  }
  return out;
}

/** `X::class` → "X" as written; anything else → undefined. */
function classConst(n: Node | null | undefined): string | undefined {
  if (n?.type !== "class_constant_access_expression") return undefined;
  const [cls, member] = n.namedChildren;
  return member?.text === "class" && cls && (cls.type === "name" || cls.type === "qualified_name") ? cls.text : undefined;
}

/** A type hint's class, as written: `Todo $todo`, `?Todo $todo`; none for `int`, `array`, unions. */
function typeName(t: Node | null | undefined): string | undefined {
  if (!t) return undefined;
  if (t.type === "named_type") return t.namedChildren[0]?.text;
  if (t.type === "optional_type") return typeName(t.namedChildren[0]);
  return undefined;
}

/** `$name` → "name". */
function varName(n: Node | null | undefined): string | undefined {
  return n?.type === "variable_name" ? n.namedChildren[0]?.text : undefined;
}

/** An HTML attribute's value in a tag's text: `action="{{ route('x') }}"`. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** A form's action or a link's href → the route it names, or the path it asks for; null for
 * anything else (another site, `#top`, a variable). */
function targetOf(value: string, twig = false): { name?: string; path?: string } | null {
  const v = value.trim();
  const echo = /^\{\{\s*([\s\S]*?)\s*\}\}$|^\{!!\s*([\s\S]*?)\s*!!\}$/.exec(v);
  if (echo) {
    const expr = echo[1] ?? echo[2];
    // Twig: path('todo_show', {id: todo.id}) and url('todo_index') name a route; Blade: route('todos.show', $todo).
    const named = (twig ? /^(?:path|url)\(\s*(['"])([\w.-]+)\1/ : /^route\(\s*(['"])([\w.-]+)\1/).exec(expr);
    if (named) return { name: named[2] };
    if (twig) return null;
    const url = /^url\(\s*(['"])([^'"]*)\1\s*\)$/.exec(expr);
    if (url) return { path: `/${url[2].replace(/^\/+/, "")}` };
    return null;
  }
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  return { path: v.split(/[?#]/)[0].replace(/\{\{[\s\S]*?\}\}|\{!![\s\S]*?!!\}/g, "*") || "/" };
}

/** Blade: forms and links that go to the app's own routes. A form's method is its `method`, unless
 * `@method('DELETE')` (or a hidden `_method` field) inside it says otherwise; a link is a GET. */
function bladeRequests(src: string, php: PhpFacts, f: FileFacts, twig = false) {
  const lineAt = (off: number) => 1 + (src.slice(0, off).match(/\n/g)?.length ?? 0);
  const label = (html: string | undefined) => html?.replace(/<[^>]*>|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || undefined;
  const out: NonNullable<PhpFacts["requests"]> = [];
  const add = (r: (typeof out)[number]) => {
    out.push(r);
    f.triggers.push({ element: r.element === "a" ? "a" : "form", ...(r.label ? { label: r.label } : {}), handler: "inline", line: r.line, range: [r.line, r.line] });
  };
  // A tag's attributes, `{{ $todo->id }}` included (its `>` does not close the tag).
  const ATTRS = String.raw`(?:\{\{[\s\S]*?\}\}|\{!![\s\S]*?!!\}|[^>])*`;
  for (const m of src.matchAll(new RegExp(String.raw`<form\b${ATTRS}>`, "gi"))) {
    const action = attr(m[0], "action");
    const to = action !== undefined ? targetOf(action, twig) : null;
    if (!to) continue;
    const start = m.index + m[0].length;
    const end = src.indexOf("</form>", start);
    const body = src.slice(start, end < 0 ? undefined : end);
    const spoofed = /@method\(\s*['"](\w+)['"]\s*\)/.exec(body)?.[1] ?? /<input\b[^>]*name=["']_method["'][^>]*value=["'](\w+)["']/i.exec(body)?.[1] ?? /<input\b[^>]*value=["'](\w+)["'][^>]*name=["']_method["']/i.exec(body)?.[1];
    const raw = (spoofed ?? attr(m[0], "method") ?? "GET").toUpperCase();
    const method = (/^(GET|POST|PUT|PATCH|DELETE)$/.test(raw) ? raw : "ANY") as Method;
    const button = /<button\b[^>]*>([\s\S]*?)<\/button>|<input\b[^>]*type=["']submit["'][^>]*value=["']([^"']*)["']/i.exec(body);
    add({ element: "form", method, ...to, label: label(button?.[1] ?? button?.[2]), line: lineAt(m.index) });
  }
  for (const m of src.matchAll(new RegExp(String.raw`<a\b(${ATTRS})>([\s\S]*?)<\/a>`, "gi"))) {
    const href = attr(m[1], "href");
    const to = href !== undefined ? targetOf(href, twig) : null;
    if (to) add({ element: "a", method: "GET", ...to, label: label(m[2]), line: lineAt(m.index) });
  }
  if (out.length) php.requests = out.sort((a, b) => a.line - b.line);
}

/** A Twig template (Symfony): a page, the templates it extends and includes, and its forms and links
 * to the app's routes (`path('todo_show', {id: todo.id})`). No grammar: what it says is in its tags. */
export function extractTwig(src: string): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const php: PhpFacts = { classes: [], modelUses: [], views: [] };
  f.php = php;
  f.hasJsx = true;
  src.split("\n").forEach((text, i) => {
    const re = /\{%-?\s*(?:extends|include|embed|import|from|use)\s+['"]([^'"]+\.twig)['"]|\binclude\(\s*['"]([^'"]+\.twig)['"]/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const spec = `view:${m[1] ?? m[2]}`;
      if (!f.imports.some((x) => x.spec === spec)) f.imports.push({ spec, names: [], line: i + 1 });
    }
  });
  bladeRequests(src, php, f, true);
  return f;
}

const FUNCTION_LIKE = new Set(["method_declaration", "function_definition", "anonymous_function", "arrow_function"]);

export function extractPhp(root: Node, src: string, path = ""): FileFacts {
  const f = emptyFacts(src.split("\n").length);
  const php: PhpFacts = { classes: [], modelUses: [], views: [] };
  f.php = php;

  // ── namespace and `use` imports: names are resolved against them ──
  const uses = new Map<string, string>();
  for (const ns of root.descendantsOfType("namespace_definition")) {
    const name = ns.childForFieldName("name")?.text;
    if (name && !php.namespace) php.namespace = name;
  }
  for (const decl of root.descendantsOfType("namespace_use_declaration")) {
    // `use function Foo\bar;` and `use const Foo\BAR;` bring no class.
    if (decl.children.some((c) => c.type === "function" || c.type === "const")) continue;
    const group = decl.childForFieldName("body");
    const groupPrefix = group ? decl.namedChildren.find((c) => c.type === "namespace_name")?.text : undefined;
    for (const clause of decl.descendantsOfType("namespace_use_clause")) {
      if (clause.children.some((c) => c.type === "function" || c.type === "const")) continue;
      const nameNode = clause.namedChildren.find((c) => c.type === "qualified_name" || c.type === "name");
      if (!nameNode) continue;
      const fqn = (groupPrefix ? `${groupPrefix}\\${nameNode.text}` : nameNode.text).replace(/^\\/, "");
      const local = clause.childForFieldName("alias")?.text ?? fqn.split("\\").pop()!;
      uses.set(local, fqn);
      f.imports.push({ spec: fqn, names: [{ local, imported: "*" }], line: line(clause) });
      const svc = NAMESPACE_SERVICES.find(([re]) => re.test(fqn))?.[1];
      if (svc) f.services.push({ service: svc, line: line(clause), via: "sdk", text: fqn });
    }
  }
  /** A class name as written → fully qualified, the way PHP resolves it. */
  const fqn = (name: string): string => {
    if (name.startsWith("\\")) return name.slice(1);
    const [head, ...rest] = name.split("\\");
    const u = uses.get(head);
    if (u) return [u, ...rest].join("\\");
    return php.namespace ? `${php.namespace}\\${name}` : name;
  };
  // A class of this file's own namespace needs no `use`: the first line that names it stands in for the import.
  const implicit = new Set<string>();
  const refer = (n: Node | null | undefined) => {
    if (!n || n.type !== "name" || !php.namespace) return;
    const name = n.text;
    if (uses.has(name) || implicit.has(name) || FACADES.has(name)) return;
    implicit.add(name);
    f.imports.push({ spec: fqn(name), names: [{ local: name, imported: "*" }], line: line(n) });
  };

  // ── Blade views: the page, and the layouts and partials it pulls in ──
  if (/\.blade\.php$/.test(path)) {
    f.hasJsx = true;
    const lines = src.split("\n");
    lines.forEach((text, i) => {
      const re = /@(?:extends|include|includeIf|includeFirst|component)\(\s*['"]([\w.-]+)['"]|<x-([\w.-]+)/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const name = m[1] ?? `components.${m[2]}`;
        if (!f.imports.some((x) => x.spec === `view:${name}`)) f.imports.push({ spec: `view:${name}`, names: [], line: i + 1 });
      }
      // Livewire: `<livewire:todo-list />`, `@livewire('todo-list')` put a component on the page.
      const lw = /<livewire:([\w.-]+)|@livewire\(\s*['"]([\w.-]+)['"]/g;
      for (let m = lw.exec(text); m; m = lw.exec(text)) {
        const spec = `livewire:${m[1] ?? m[2]}`;
        if (!f.imports.some((x) => x.spec === spec)) f.imports.push({ spec, names: [], line: i + 1 });
      }
      // wire:click="save", wire:submit.prevent="add(1)": the method of the page's component it runs ($set, $refresh: Livewire's own).
      const wire = /\bwire:([\w-]+)(?:\.[\w.-]+)?\s*=\s*["']\s*([A-Za-z_]\w*)/g;
      for (let m = wire.exec(text); m; m = wire.exec(text)) {
        if (!WIRE_NOT_ACTIONS.has(m[1])) (php.wires ??= []).push({ event: m[1], method: m[2], line: i + 1 });
      }
    });
    bladeRequests(src, php, f);
  }

  // ── classes, methods and functions ──
  const classNodes = ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"].flatMap((t) => root.descendantsOfType(t));
  for (const c of classNodes) {
    const name = c.childForFieldName("name")?.text;
    if (!name) continue;
    const base = c.namedChildren.find((x) => x.type === "base_clause")?.namedChildren[0];
    refer(base);
    const cls: PhpFacts["classes"][number] = { fqn: php.namespace ? `${php.namespace}\\${name}` : name, line: line(c), end: endLine(c), methods: [] };
    if (base && c.type === "class_declaration") cls.extends = fqn(base.text);
    for (const member of c.childForFieldName("body")?.namedChildren ?? []) {
      if (member.type === "method_declaration") {
        const m = member.childForFieldName("name")?.text;
        if (m) cls.methods.push({ name: m, start: line(member), end: endLine(member) });
      }
      if (member.type !== "property_declaration") continue;
      for (const el of member.namedChildren.filter((x) => x.type === "property_element")) {
        const table = varName(el.childForFieldName("name")) === "table" ? strArg(el.childForFieldName("default_value")) : undefined;
        if (table) cls.table = { name: table, line: line(el) };
      }
    }
    php.classes.push(cls);
    f.exports.push(name);
    f.nested.push({ name, start: cls.line, end: cls.end });
  }

  /** Classes a class's properties hold: `private TodoService $todos;` and promoted constructor parameters. */
  const propTypesOf = (cls: Node | null): Map<string, string> => {
    const out = new Map<string, string>();
    if (!cls) return out;
    for (const prop of cls.childForFieldName("body")?.namedChildren.filter((x) => x.type === "property_declaration") ?? []) {
      const t = typeName(prop.childForFieldName("type"));
      if (!t) continue;
      for (const el of prop.namedChildren.filter((x) => x.type === "property_element")) {
        const v = varName(el.childForFieldName("name"));
        if (v) out.set(v, t);
      }
    }
    for (const p of cls.descendantsOfType("property_promotion_parameter")) {
      const t = typeName(p.childForFieldName("type"));
      const v = varName(p.childForFieldName("name"));
      if (t && v) out.set(v, t);
    }
    return out;
  };

  /** The class a variable in this function holds: a typed parameter (`Todo $todo`, route model binding),
   * `$todo = new Todo` or `$todo = Todo::find($id)`. */
  const varTypesOf = (fn: Node): Map<string, string> => {
    const out = new Map<string, string>();
    for (const p of [...fn.descendantsOfType("simple_parameter"), ...fn.descendantsOfType("property_promotion_parameter")]) {
      const t = typeName(p.childForFieldName("type"));
      const v = varName(p.childForFieldName("name"));
      if (t && v) out.set(v, t);
    }
    for (const a of fn.descendantsOfType("assignment_expression")) {
      const v = varName(a.childForFieldName("left"));
      const right = a.childForFieldName("right");
      if (!v || !right) continue;
      if (right.type === "object_creation_expression") {
        const n = right.namedChildren.find((x) => x.type === "name" || x.type === "qualified_name");
        if (n) out.set(v, n.text);
      } else if (right.type === "scoped_call_expression") {
        const scope = right.childForFieldName("scope");
        const m = callName(right);
        if (scope && (scope.type === "name" || scope.type === "qualified_name") && m && /^(find|findOrFail|first|firstOrFail|firstOrNew|firstOrCreate|create|make|sole|firstWhere)$/.test(m)) out.set(v, scope.text);
      } else if (right.type === "member_call_expression" && callName(right) === "getRepository") {
        // Doctrine: $repo = $em->getRepository(Todo::class) works on the entity's table.
        const cls = classConst(argsOf(right)[0]?.value);
        if (cls) out.set(v, cls);
      }
    }
    return out;
  };

  /** The class an expression's value is an instance of: `$todo`, `$this->todos`. */
  const typeOfExpr = (n: Node | null, vars: Map<string, string>, props: Map<string, string>): string | undefined => {
    if (!n) return undefined;
    const v = varName(n);
    if (v) return v === "this" ? undefined : vars.get(v);
    if (n.type === "member_access_expression" && varName(n.childForFieldName("object")) === "this") {
      const p = n.childForFieldName("name")?.text;
      return p ? props.get(p) : undefined;
    }
    return undefined;
  };

  // Functions and methods: their range, what they call ("Todo.all", "TodoService.create", "helper").
  const enclosingClass = (n: Node): Node | null => {
    for (let p = n.parent; p; p = p.parent) if (p.type === "class_declaration" || p.type === "trait_declaration" || p.type === "enum_declaration" || p.type === "anonymous_class") return p;
    return null;
  };
  const fnNodes = [...root.descendantsOfType("method_declaration"), ...root.descendantsOfType("function_definition")];
  for (const fn of fnNodes) {
    const name = fn.childForFieldName("name")?.text;
    if (!name) continue;
    const cls = enclosingClass(fn);
    const vars = varTypesOf(fn);
    const props = propTypesOf(cls);
    const calls = new Set<string>();
    for (const c of fn.descendantsOfType(["scoped_call_expression", "member_call_expression", "nullsafe_member_call_expression", "function_call_expression", "object_creation_expression"])) {
      if (c.type === "function_call_expression") {
        const callee = c.childForFieldName("function");
        if (callee?.type === "name") calls.add(callee.text);
      } else if (c.type === "object_creation_expression") {
        const n = c.namedChildren.find((x) => x.type === "name" || x.type === "qualified_name");
        if (n) calls.add(n.text);
      } else if (c.type === "scoped_call_expression") {
        const scope = c.childForFieldName("scope");
        const m = callName(c);
        if (scope && (scope.type === "name" || scope.type === "qualified_name") && !/^(self|static|parent)$/.test(scope.text) && m) calls.add(`${scope.text}.${m}`);
      } else {
        const t = typeOfExpr(c.childForFieldName("object"), vars, props);
        const m = callName(c);
        if (t && m) calls.add(`${t}.${m}`);
      }
    }
    const vis = fn.namedChildren.find((x) => x.type === "visibility_modifier")?.text;
    f.fns.push({ name, start: line(fn), end: endLine(fn), calls: [...calls], exported: fn.type === "function_definition" || !vis || vis === "public" });
  }

  // Names this file's code refers to: the first line naming a class of the same namespace imports it.
  for (const n of root.descendantsOfType(["scoped_call_expression", "object_creation_expression", "class_constant_access_expression", "named_type"])) {
    if (n.type === "scoped_call_expression") refer(n.childForFieldName("scope"));
    else refer(n.namedChildren[0]);
  }

  // ── Eloquent: calls on a class (Todo::all()) and on an instance of one ($todo->save()) ──
  for (const c of root.descendantsOfType("scoped_call_expression")) {
    const scope = c.childForFieldName("scope");
    const m = callName(c);
    if (!scope || !m || (scope.type !== "name" && scope.type !== "qualified_name")) continue;
    const name = scope.text.replace(/^\\/, "");
    if (name === "DB" || name === "Illuminate\\Support\\Facades\\DB") {
      // DB::table('todos')->where(...)->update(...): the table by name.
      const table = m === "table" ? strArg(argsOf(c)[0]?.value) : undefined;
      if (table) f.sql.push({ table, op: callsAfter(c).some((x) => MODEL_WRITE.has(x)) ? "write" : "read", line: line(c) });
      continue;
    }
    if (FACADES.has(name.split("\\").pop()!) || !isQuery(m)) continue;
    const after = callsAfter(c);
    php.modelUses.push({ cls: fqn(scope.text), op: [m, ...after].some((x) => MODEL_WRITE.has(x)) ? "write" : "read", line: line(c) });
  }
  // Variables are typed per function: a method, a function, or a closure outside both (a route's).
  const scopes = root.descendantsOfType([...FUNCTION_LIKE]).filter((fn) => {
    for (let p = fn.parent; p; p = p.parent) if (FUNCTION_LIKE.has(p.type)) return false;
    return true;
  });
  for (const fn of scopes) {
    const vars = varTypesOf(fn);
    const props = propTypesOf(enclosingClass(fn));
    const own = enclosingClass(fn)?.childForFieldName("name")?.text;
    for (const c of fn.descendantsOfType(["member_call_expression", "nullsafe_member_call_expression"])) {
      const m = callName(c);
      if (!m) continue;
      const obj = c.childForFieldName("object");
      // Doctrine: $em->persist($todo) and remove($todo) write the entity's table; $em->getRepository(Todo::class)->findAll() reads it.
      if (m === "persist" || m === "remove") {
        const arg = argsOf(c)[0]?.value;
        const t = arg?.type === "object_creation_expression" ? arg.namedChildren.find((x) => x.type === "name" || x.type === "qualified_name")?.text : typeOfExpr(arg ?? null, vars, props);
        if (t) php.modelUses.push({ cls: fqn(t), op: "write", line: line(c) });
        continue;
      }
      if (m === "getRepository") {
        const cls = classConst(argsOf(c)[0]?.value);
        if (cls) php.modelUses.push({ cls: fqn(cls), op: callsAfter(c).some((x) => MODEL_WRITE.has(x)) ? "write" : "read", line: line(c) });
        continue;
      }
      if (REPO_READ.has(m)) {
        // A repository's own query ($this->createQueryBuilder('t')), or a call on one ($todos->findAll()).
        const t = varName(obj) === "this" ? own && php.namespace ? `${php.namespace}\\${own}` : own : typeOfExpr(obj, vars, props);
        if (t && !FACADES.has(t)) php.modelUses.push({ cls: varName(obj) === "this" ? t : fqn(t), op: "read", line: line(c) });
        continue;
      }
      if (!(MODEL_WRITE.has(m) || m === "refresh" || m === "fresh" || m === "load")) continue;
      const t = typeOfExpr(obj, vars, props);
      if (t && !FACADES.has(t)) php.modelUses.push({ cls: fqn(t), op: MODEL_WRITE.has(m) ? "write" : "read", line: line(c) });
    }
  }

  // ── migrations: Schema::create('todos', function (Blueprint $table) { $table->string('title'); }) ──
  for (const c of root.descendantsOfType("scoped_call_expression")) {
    if (c.childForFieldName("scope")?.text.replace(/^\\/, "").split("\\").pop() !== "Schema") continue;
    const m = callName(c);
    if (m !== "create" && m !== "table") continue;
    const [first, second] = argsOf(c);
    const table = strArg(first?.value);
    if (!table) continue;
    f.sql.push({ table, op: "define", line: line(c) });
    const fn = second?.value;
    const param = fn && FUNCTION_LIKE.has(fn.type) ? varName(fn.childForFieldName("parameters")?.namedChildren[0]?.childForFieldName("name")) : undefined;
    if (!fn || !param) continue;
    const columns: { name: string; type: string }[] = [];
    const add = (type: string, ...names: string[]) => {
      for (const n of names) if (n && !columns.some((x) => x.name === n)) columns.push({ name: n, type });
    };
    for (const call of fn.descendantsOfType("member_call_expression")) {
      // Only the first call of a chain on $table names the column: `$table->string('title')->nullable()`.
      if (varName(call.childForFieldName("object")) !== param) continue;
      const col = callName(call) ?? "";
      if (NOT_COLUMNS.has(col)) continue;
      const args = argsOf(call);
      const arg = strArg(args[0]?.value);
      // The Blueprint method is the column's type, as Laravel names it: string, boolean, foreignId.
      if (col === "id") add("id", arg ?? "id");
      else if (/^(timestamps|timestampsTz|nullableTimestamps)$/.test(col)) add("timestamp", "created_at", "updated_at");
      else if (/^softDeletes(Tz)?$/.test(col)) add("timestamp", arg ?? "deleted_at");
      else if (col === "rememberToken") add("string", "remember_token");
      else if (/^(nullable)?(uuid|ulid)?morphs$/i.test(col) && arg) {
        add(/uuid/i.test(col) ? "uuid" : /ulid/i.test(col) ? "ulid" : "unsignedBigInteger", `${arg}_id`);
        add("string", `${arg}_type`);
      } else if (col === "foreignIdFor") {
        // foreignIdFor(User::class) → user_id
        const cls = classConst(args[0]?.value);
        if (cls) add("foreignId", `${snake(cls.split("\\").pop()!)}_id`);
      } else if (arg) add(col, arg);
    }
    if (columns.length) (f.columns ??= []).push({ table, columns, line: line(c) });
  }

  // ── Symfony and Doctrine: attributes on classes, methods and properties ──
  /** A declaration's attributes, each with its class fully qualified: `#[ORM\Column(...)]` → Doctrine\ORM\Mapping\Column. */
  const attrsOf = (decl: Node) =>
    (decl.childForFieldName("attributes")?.descendantsOfType("attribute") ?? []).flatMap((a) => {
      const n = a.namedChildren.find((x) => x.type === "name" || x.type === "qualified_name");
      return n ? [{ node: a, fqn: fqn(n.text), short: n.text.split("\\").pop()! }] : [];
    });
  const isRouteAttr = (a: { fqn: string; short: string }) => a.short === "Route" && (/^Symfony\\/.test(a.fqn) || !a.fqn.includes("\\") || a.fqn === `${php.namespace}\\Route`);
  const isOrm = (a: { fqn: string }, name: string) => a.fqn === `Doctrine\\ORM\\Mapping\\${name}`;
  /** A named argument, else the positional one at `at`. */
  const argOf = (a: Node, name: string, at?: number) => {
    const args = argsOf(a);
    return args.find((x) => x.name === name)?.value ?? (at !== undefined ? args.filter((x) => !x.name)[at]?.value : undefined);
  };
  /** `type: 'string'`, `type: Types::DATETIME_IMMUTABLE` → "string", "datetime_immutable". */
  const ormType = (n: Node | undefined): string | undefined => {
    if (!n) return undefined;
    const s = strArg(n);
    if (s) return s;
    if (n.type === "class_constant_access_expression") return n.namedChildren[1]?.text.toLowerCase();
    return undefined;
  };
  for (const c of root.descendantsOfType("class_declaration")) {
    const name = c.childForFieldName("name")?.text;
    const cls = php.classes.find((x) => x.line === line(c) && x.fqn.split("\\").pop() === name);
    if (!name || !cls) continue;
    const attrs = attrsOf(c);
    const methods = (c.childForFieldName("body")?.namedChildren ?? []).filter((m) => m.type === "method_declaration");

    // Routes: #[Route('/todos', name: 'todo_index', methods: ['GET'])] on a method, under the class's own #[Route('/api', name: 'api_')].
    const prefixAttr = attrs.find(isRouteAttr);
    const prefix = prefixAttr ? (strArg(argOf(prefixAttr.node, "path", 0)) ?? "") : "";
    const namePrefix = prefixAttr ? (strArg(argOf(prefixAttr.node, "name")) ?? "") : "";
    const routeAt = (a: Node, method: string, start: number, end: number, path: string, names = namePrefix) => {
      const verbs = argOf(a, "methods");
      const one = strArg(verbs);
      const list = one !== undefined ? [one] : (verbs?.namedChildren.map((x) => strArg(x.namedChildren[0])).filter((x): x is string => !!x) ?? []);
      const routeName = strArg(argOf(a, "name"));
      for (const v of list.length ? list : ["ANY"]) {
        const m = v.toUpperCase();
        const r: RouteFact = { method: (/^(GET|POST|PUT|PATCH|DELETE)$/.test(m) ? m : "ANY") as Method, path: joinUri(prefix, path), line: start, endLine: end, handler: method };
        if (routeName !== undefined) r.name = names + routeName;
        f.routes.push(r);
      }
    };
    let ownRoutes = 0;
    for (const m of methods) {
      const mName = m.childForFieldName("name")?.text;
      for (const a of attrsOf(m).filter(isRouteAttr)) {
        const path = strArg(argOf(a.node, "path", 0));
        if (path === undefined || !mName) continue;
        routeAt(a.node, mName, line(a.node), endLine(a.node), path);
        ownRoutes++;
      }
    }
    // An invokable controller routed on the class itself: #[Route('/health')] class Health { __invoke() }.
    if (prefixAttr && !ownRoutes && methods.some((m) => m.childForFieldName("name")?.text === "__invoke")) routeAt(prefixAttr.node, "__invoke", line(prefixAttr.node), endLine(prefixAttr.node), "", "");

    // A Doctrine repository: parent::__construct($registry, Todo::class).
    for (const call of c.descendantsOfType("scoped_call_expression")) {
      if (call.childForFieldName("scope")?.text !== "parent" || callName(call) !== "__construct") continue;
      const entity = argsOf(call).map((x) => classConst(x.value)).find(Boolean);
      if (entity) cls.entityOf = fqn(entity);
    }

    // A Doctrine entity: its table, its columns, its repository.
    const entity = attrs.find((a) => isOrm(a, "Entity"));
    if (!entity) continue;
    const tableAttr = attrs.find((a) => isOrm(a, "Table"));
    const table = (tableAttr && strArg(argOf(tableAttr.node, "name", 0))) || snake(name);
    const at = line(tableAttr?.node ?? entity.node);
    const repo = classConst(argOf(entity.node, "repositoryClass", 0));
    cls.table = { name: table, line: at };
    cls.entity = repo ? { repository: fqn(repo) } : {};
    f.sql.push({ table, op: "define", line: at });
    const columns: { name: string; type?: string }[] = [];
    for (const prop of (c.childForFieldName("body")?.namedChildren ?? []).filter((x) => x.type === "property_declaration")) {
      const pa = attrsOf(prop);
      const prop0 = varName(prop.namedChildren.find((x) => x.type === "property_element")?.childForFieldName("name"));
      if (!prop0) continue;
      const col = pa.find((a) => isOrm(a, "Column"));
      const rel = pa.find((a) => isOrm(a, "ManyToOne") || isOrm(a, "OneToOne"));
      if (col) {
        const type = ormType(argOf(col.node, "type", 0)) ?? prop.childForFieldName("type")?.text.replace(/^\?/, "");
        const n = strArg(argOf(col.node, "name")) ?? snake(prop0);
        columns.push(type ? { name: n, type } : { name: n });
      } else if (rel) {
        // The owning side of a relation holds the other row's id: `owner` → owner_id (JoinColumn may rename it).
        const join = pa.find((a) => isOrm(a, "JoinColumn"));
        columns.push({ name: (join && strArg(argOf(join.node, "name", 0))) || `${snake(prop0)}_id`, type: rel.short });
      }
    }
    if (columns.length) (f.columns ??= []).push({ table, columns, line: at });
  }

  // ── routes: Route::get('/x', ...), resources, groups with a prefix or a controller ──
  interface Ctx {
    prefix: string;
    controller?: string;
    name: string;
  }
  const isRoute = (n: Node | null) => !!n && /^\\?(Illuminate\\Support\\Facades\\)?Route$/.test(n.text);
  /** The handler argument → closure (undefined) or the controller method. */
  const handlerOf = (n: Node | undefined, ctx: Ctx): RouteFact["controller"] | null => {
    if (!n) return null;
    if (n.type === "anonymous_function" || n.type === "arrow_function") return undefined;
    if (n.type === "array_creation_expression") {
      const [a, b] = n.namedChildren.map((x) => x.namedChildren[0]);
      const cls = classConst(a);
      const method = strArg(b);
      if (cls && method) return { cls: fqn(cls), method };
      return null;
    }
    const cls = classConst(n);
    if (cls) return { cls: fqn(cls), method: "__invoke" };
    const s = strArg(n);
    if (s === undefined) return null;
    if (ctx.controller && !s.includes("@")) return { cls: ctx.controller, method: s };
    const at = /^([\w\\]+)@(\w+)$/.exec(s);
    // Before Laravel 8 a 'TodoController@index' string was read under App\Http\Controllers; nothing in the file says so.
    if (at) return { cls: at[1].startsWith("\\") ? at[1].slice(1) : uses.get(at[1]) ?? `App\\Http\\Controllers\\${at[1]}`, method: at[2], legacy: !uses.has(at[1]) };
    return null;
  };
  const addRoute = (method: Method, uri: string, stmt: Node, ctx: Ctx, controller: RouteFact["controller"], name?: string) => {
    const r: RouteFact = { method, path: joinUri(ctx.prefix, uri), line: line(stmt), endLine: endLine(stmt) };
    if (controller) {
      r.controller = controller;
      r.handler = `${controller.cls.split("\\").pop()}@${controller.method}`;
    }
    if (name) r.name = name;
    f.routes.push(r);
  };
  const routeExpr = (e: Node, stmt: Node, ctx: Ctx) => {
    const chain = chainOf(e);
    if (!chain || !isRoute(chain[0].childForFieldName("scope"))) return;
    const byName = (n: string) => chain.find((c) => callName(c) === n);
    const nameArg = byName("name") ?? byName("as");
    const routeName = nameArg ? strArg(argsOf(nameArg)[0]?.value) : undefined;
    const group = byName("group");
    if (group) {
      const next: Ctx = { ...ctx };
      for (const c of chain) {
        const n = callName(c);
        const arg = argsOf(c)[0]?.value;
        if (n === "prefix" && strArg(arg) !== undefined) next.prefix = joinUri(next.prefix, strArg(arg)!);
        if (n === "controller" && classConst(arg)) next.controller = fqn(classConst(arg)!);
        if ((n === "name" || n === "as") && strArg(arg)) next.name += strArg(arg);
      }
      const args = argsOf(group);
      // Route::group(['prefix' => 'admin', 'as' => 'admin.'], function () { ... })
      const opts = args.find((a) => a.value.type === "array_creation_expression")?.value;
      for (const el of opts?.namedChildren ?? []) {
        const [k, v] = el.namedChildren;
        const key = strArg(k);
        if (key === "prefix" && strArg(v) !== undefined) next.prefix = joinUri(next.prefix, strArg(v)!);
        if (key === "as" && strArg(v)) next.name += strArg(v);
        if (key === "controller" && classConst(v)) next.controller = fqn(classConst(v)!);
      }
      const body = args[args.length - 1]?.value;
      if (body?.type === "anonymous_function") statements(body.childForFieldName("body"), next);
      else if (body?.type === "arrow_function") {
        const inner = body.childForFieldName("body");
        if (inner) routeExpr(inner, inner, next);
      }
      return;
    }
    const first = chain[0];
    const verb = callName(first) ?? "";
    const args = argsOf(first).map((a) => a.value);
    const fullName = routeName !== undefined ? ctx.name + routeName : undefined;
    if (verb in ROUTE_VERBS || verb === "match") {
      const methods = verb === "match" ? (args[0]?.namedChildren.map((x) => strArg(x.namedChildren[0])?.toUpperCase()).filter((m): m is string => !!m) ?? []) : [ROUTE_VERBS[verb]];
      const at = verb === "match" ? 1 : 0;
      const uri = strArg(args[at]);
      if (uri === undefined) return;
      const controller = handlerOf(args[at + 1], ctx);
      // A handler WalkMyCode can't read (a variable, a callable string) still registers the route; it just links nowhere.
      for (const m of methods) {
        const method = (m === "GET" || m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE" ? m : "ANY") as Method;
        if (!f.routes.some((r) => r.method === method && r.path === joinUri(ctx.prefix, uri) && r.line === line(stmt))) addRoute(method, uri, stmt, ctx, controller ?? undefined, fullName);
      }
      return;
    }
    if (verb === "view") {
      const uri = strArg(args[0]);
      const view = strArg(args[1]);
      if (uri === undefined || !view) return;
      addRoute("GET", uri, stmt, ctx, undefined, fullName);
      php.views.push({ name: view, line: line(first) });
      return;
    }
    if (verb === "resource" || verb === "apiResource") {
      const res = strArg(args[0]);
      const cls = classConst(args[1]);
      if (!res || !cls) return;
      const parts = res.split(".");
      const last = parts[parts.length - 1];
      const param = singular(last);
      const base = [...parts.slice(0, -1).map((p) => `${p}/{${singular(p)}}`), last].join("/");
      const list = (n: string) => {
        const c = byName(n);
        const a = c ? argsOf(c)[0]?.value : undefined;
        if (!a) return undefined;
        const one = strArg(a);
        return one !== undefined ? [one] : a.namedChildren.map((x) => strArg(x.namedChildren[0])).filter((x): x is string => !!x);
      };
      const only = list("only");
      const except = list("except") ?? [];
      for (const a of RESOURCE_ACTIONS) {
        if (verb === "apiResource" && (a.action === "create" || a.action === "edit")) continue;
        if ((only && !only.includes(a.action)) || except.includes(a.action)) continue;
        for (const m of a.methods) addRoute(m, `${base}${a.suffix(param)}`, stmt, ctx, { cls: fqn(cls), method: a.action }, `${ctx.name}${res}.${a.action}`);
      }
    }
  };
  const statements = (block: Node | null, ctx: Ctx) => {
    for (const s of block?.namedChildren ?? []) {
      if (s.type === "expression_statement" && s.namedChildren[0]) routeExpr(s.namedChildren[0], s, ctx);
      else if (s.type === "compound_statement") statements(s, ctx);
    }
  };
  statements(root, { prefix: "", name: "" });

  // ── views: view('todos.index'), View::make(...), response()->view(...), Inertia::render('Todos/Index') ──
  for (const c of root.descendantsOfType(["function_call_expression", "scoped_call_expression", "member_call_expression"])) {
    const m = callName(c);
    const first = argsOf(c)[0]?.value;
    if (c.type === "function_call_expression" && (m === "view" || m === "inertia")) {
      const name = strArg(first);
      if (name) php.views.push({ name, line: line(c), ...(m === "inertia" ? { inertia: true } : {}) });
      continue;
    }
    if (c.type === "scoped_call_expression") {
      const scope = c.childForFieldName("scope")?.text.split("\\").pop();
      const name = strArg(first);
      if (name && scope === "View" && m === "make") php.views.push({ name, line: line(c) });
      if (name && scope === "Inertia" && m === "render") php.views.push({ name, line: line(c), inertia: true });
      continue;
    }
    // response()->view('x'); Symfony's $this->render('todo/index.html.twig') (and renderView, renderForm).
    const obj = c.childForFieldName("object");
    if (/^(render|renderView|renderForm|renderBlock)$/.test(m ?? "") && varName(obj) === "this") {
      const name = strArg(first);
      if (name && /\.twig$/.test(name)) php.views.push({ name, line: line(c) });
      continue;
    }
    if (m === "view" && obj?.type === "function_call_expression" && callName(obj) === "response") {
      const name = strArg(first);
      if (name) php.views.push({ name, line: line(c) });
    }
  }

  // ── env() reads and outgoing requests ──
  const envRead = (name: string, at: number) => {
    f.envReads.push({ name, line: at });
    const svc = serviceForEnv(name);
    if (svc) f.services.push({ service: svc, line: at, via: "env", text: name });
  };
  /** A URL expression → its text with `*` for each piece built at run time, and the setting it starts with. */
  const urlOf = (n: Node | undefined): Pick<HttpCallFact, "url" | "fromVariable" | "varName" | "literalBase"> | null => {
    if (!n) return null;
    const s = strOf(n);
    if (s) return { url: s.text, fromVariable: s.lead };
    if (n.type === "parenthesized_expression") return urlOf(n.namedChildren[0]);
    if (n.type === "function_call_expression" && callName(n) === "env") {
      const [name, fallback] = argsOf(n).map((a) => a.value);
      const v = strArg(name);
      const lit = strArg(fallback);
      return v ? { url: "*", fromVariable: true, varName: v, ...(lit !== undefined ? { literalBase: lit } : {}) } : null;
    }
    if (n.type === "binary_expression" && n.children.some((c) => c.type === ".")) {
      const l = urlOf(n.childForFieldName("left") ?? undefined) ?? { url: "*", fromVariable: true };
      const r = urlOf(n.childForFieldName("right") ?? undefined) ?? { url: "*", fromVariable: false };
      return { ...l, url: (l.url + r.url).replace(/\*{2,}/g, "*") };
    }
    // config('services.x.url'), $this->base, a constant: a base WalkMyCode can't read here.
    return { url: "*", fromVariable: true };
  };
  const pushHttp = (u: ReturnType<typeof urlOf>, method: Method, at: number, callee: string) => {
    if (!u || (u.url === "*" && !u.varName)) return;
    if (!/^(https?:\/\/|wss?:\/\/|\/|\*)/i.test(u.url)) return;
    const h: HttpCallFact = { url: u.url, method, line: at, callee, fromVariable: u.fromVariable };
    if (u.varName) h.varName = u.varName;
    if (u.literalBase !== undefined) h.literalBase = u.literalBase;
    f.http.push(h);
  };
  for (const c of root.descendantsOfType(["function_call_expression", "scoped_call_expression", "member_call_expression", "nullsafe_member_call_expression"])) {
    const m = callName(c) ?? "";
    const args = argsOf(c).map((a) => a.value);
    const at = line(c);
    if (c.type === "function_call_expression") {
      if (m === "env" && strArg(args[0])) envRead(strArg(args[0])!, at);
      // file_get_contents('https://...'), curl_init('https://...'): only a URL written out.
      if ((m === "file_get_contents" || m === "curl_init") && /^https?:\/\//.test(strOf(args[0])?.text ?? "")) pushHttp(urlOf(args[0]), "GET", at, m);
      continue;
    }
    const verb = HTTP_VERBS[m];
    if (!verb && m !== "request" && m !== "send") continue;
    const chain = chainOf(c);
    const root0 = chain?.[0].childForFieldName("scope")?.text.replace(/^\\/, "");
    if (chain && (root0 === "Http" || root0 === "Illuminate\\Support\\Facades\\Http")) {
      // Http::withToken($t)->baseUrl('https://api.x.com')->post('/v1/charges')
      const method = verb ?? (m === "send" ? (strArg(args[0])?.toUpperCase() as Method | undefined) : undefined);
      const urlArg = m === "send" ? args[1] : args[0];
      let u = urlOf(urlArg);
      const baseCall = chain.find((x) => callName(x) === "baseUrl");
      if (u && baseCall && u.url.startsWith("/")) {
        const b = urlOf(argsOf(baseCall)[0]?.value);
        if (b) u = { ...b, url: (b.url.replace(/\/$/, "") + u.url).replace(/\*{2,}/g, "*") };
      }
      if (method && /^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) pushHttp(u, method, at, `Http.${m}`);
      continue;
    }
    // Guzzle and other clients: $client->get('https://...'), $client->request('POST', 'https://...').
    // A URL must be written out: `$request->get('title')` reads a form field.
    const urlArg = m === "request" ? args[1] : args[0];
    const method = m === "request" ? (strArg(args[0])?.toUpperCase() as Method | undefined) : verb;
    const u = urlOf(urlArg);
    if (method && u && /^https?:\/\//i.test(u.url) && /^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) {
      const obj = c.childForFieldName("object");
      pushHttp(u, method, at, `${obj?.text.replace(/^\$/, "") ?? "client"}.${m}`);
    }
  }

  // ── SQL and outside services' hosts in string literals ──
  const seen = new Set<string>();
  for (const s of root.descendantsOfType(["string", "encapsed_string", "heredoc", "nowdoc"])) {
    const t = strOf(s);
    if (!t) continue;
    const startLine = line(s);
    const lineOf = (off: number) => startLine + (t.text.slice(0, off).match(/\n/g)?.length ?? 0);
    for (const q of sqlInString(t.text, lineOf)) {
      const k = `${q.table}|${q.op}|${q.line}`;
      if (!seen.has(k)) {
        seen.add(k);
        f.sql.push(q);
      }
    }
    for (const col of sqlColumns(t.text, lineOf)) (f.columns ??= []).push(col);
    for (const sv of serviceFacts(t.text, startLine, "host")) f.services.push(sv);
  }
  return f;
}

/** A class to the file it is in: the class a parsed file declares, else composer.json's PSR-4 map
 * ("App\\" → app/). A `view:todos.index` spec (Blade's @extends, @include) → the view's file. */
export type PhpResolve = (from: string, spec: string) => string | null;

export function phpResolver(files: string[], contentOf: (p: string) => string | undefined, facts: Record<string, FileFacts>, areaOf: (p: string) => string): PhpResolve {
  const fileSet = new Set(files);
  const byClass = new Map<string, string>();
  for (const p of files) for (const c of facts[p]?.php?.classes ?? []) if (!byClass.has(c.fqn.toLowerCase())) byClass.set(c.fqn.toLowerCase(), p);
  // Livewire components by the name `<livewire:todo-list />` gives them.
  const livewire = new Map<string, string[]>();
  for (const p of files) {
    for (const c of facts[p]?.php?.classes ?? []) {
      const n = livewireName(c.fqn);
      if (n && c.extends) livewire.set(n, [...(livewire.get(n) ?? []), p]);
    }
  }
  const psr4: { prefix: string; dir: string }[] = [];
  for (const p of allComposer(contentOf, files)) {
    let json: { autoload?: { "psr-4"?: Record<string, string | string[]> }; "autoload-dev"?: { "psr-4"?: Record<string, string | string[]> } };
    try {
      json = JSON.parse(contentOf(p) ?? "");
    } catch {
      continue;
    }
    const root = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    for (const map of [json.autoload?.["psr-4"], json["autoload-dev"]?.["psr-4"]]) {
      for (const [prefix, dirs] of Object.entries(map ?? {})) {
        for (const d of Array.isArray(dirs) ? dirs : [dirs]) psr4.push({ prefix, dir: [root, d.replace(/^\.?\/+|\/+$/g, "")].filter(Boolean).join("/") });
      }
    }
  }
  psr4.sort((a, b) => b.prefix.length - a.prefix.length);
  return (from, spec) => {
    const view = /^view:(.+)$/.exec(spec);
    if (view) return viewFile(files, areaOf, from, view[1]);
    const lw = /^livewire:(.+)$/.exec(spec);
    if (lw) {
      const hits = livewire.get(lw[1].toLowerCase()) ?? [];
      const own = hits.filter((p) => areaOf(p) === areaOf(from));
      return (own.length ? own : hits)[0] ?? null;
    }
    const cls = spec.replace(/^\\/, "");
    const hit = byClass.get(cls.toLowerCase());
    if (hit) return hit;
    for (const { prefix, dir } of psr4) {
      if (!cls.startsWith(prefix)) continue;
      const p = [dir, `${cls.slice(prefix.length).replace(/\\/g, "/")}.php`].filter(Boolean).join("/");
      if (fileSet.has(p)) return p;
    }
    return null;
  };
}

/** A Livewire component's name, as `<livewire:...>` and its view are named: App\Livewire\Todos\TodoList →
 * todos.todo-list (App\Http\Livewire\ in Livewire 2). Undefined for a class outside a Livewire namespace. */
export function livewireName(fqn: string): string | undefined {
  const parts = fqn.split("\\");
  const at = parts.findIndex((p) => p.toLowerCase() === "livewire");
  if (at < 0 || at === parts.length - 1) return undefined;
  return parts
    .slice(at + 1)
    .map((p) => p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").toLowerCase())
    .join(".");
}

/** composer.json files are not code, so they are not in the parsed list: find them beside it. */
function allComposer(contentOf: (p: string) => string | undefined, files: string[]): string[] {
  const dirs = new Set<string>([""]);
  for (const p of files) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [...dirs].map((d) => (d ? `${d}/composer.json` : "composer.json")).filter((p) => contentOf(p) !== undefined && !/(^|\/)vendor\//.test(p));
}

/** A view name → its file: 'todos.index' → resources/views/todos/index.blade.php in the caller's package;
 * an Inertia page 'Todos/Index' → resources/js/Pages/Todos/Index.tsx (or .jsx, .vue...). */
function viewFile(files: string[], areaOf: (p: string) => string, from: string, name: string, inertia = false): string | null {
  if (name.includes("::")) return null; // a package's view (mail::message): not in the workspace
  const under = (p: string, e: string) => p === e || p.endsWith(`/${e}`);
  // A Twig template by its path under templates/ ('todo/index.html.twig'); '@Bundle/x.html.twig' is a bundle's.
  if (/\.twig$/.test(name) && name.startsWith("@")) return null;
  const hits = /\.twig$/.test(name)
    ? files.filter((p) => under(p, `templates/${name}`))
    : inertia
    ? files.filter((p) => /\.(vue|svelte|[jt]sx?)$/.test(p) && [`resources/js/Pages/${name}`, `resources/js/pages/${name}`].some((e) => under(p.replace(/\.[^.]+$/, ""), e)))
    : files.filter((p) => [`resources/views/${name.replace(/\./g, "/")}.blade.php`, `resources/views/${name.replace(/\./g, "/")}.php`].some((e) => under(p, e)));
  const own = hits.filter((p) => areaOf(p) === areaOf(from));
  const pick = own.length ? own : hits;
  return pick.length === 1 ? pick[0] : (pick.find((p) => p.endsWith(".blade.php")) ?? null);
}

/** A route's controller method, found. */
export interface PhpHandler {
  /** The routes file and the route in it (the same object as in its facts). */
  file: string;
  route: RouteFact;
  /** The controller's file, and the method's lines there when it defines it. */
  target: string;
  method: string;
  start?: number;
  end?: number;
  confidence: "certain" | "likely";
  note?: string;
}

export interface PhpLinks {
  handlers: PhpHandler[];
  /** A line that returns a page, the page's file, and the routes that run that line (none: the line's own card). */
  views: { file: string; line: number; target: string; routes: RouteFact[]; own?: boolean }[];
  /** A Blade form or link → the routes it goes to, found by the route's name or by method and path. */
  requests: { file: string; line: number; element: "form" | "a"; label?: string; routes: RouteFact[]; confidence: "certain" | "likely"; note?: string }[];
  /** Livewire: a `wire:click` in a component's view → the component method it runs. */
  wires: { file: string; line: number; event: string; target: string; method: string; start: number; end: number }[];
  /** What could not be settled, in words, for the map's warnings. */
  warnings: string[];
}

/** A path's segments; `*` for each piece of a request built at run time, or a route's `{param}`. */
function segsOf(path: string, route: boolean): string[] {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((s) => (route ? (/^\{.*\}$/.test(s) ? "*" : s) : s.includes("*") ? "*" : s));
}

/** Does a request's path fit a route's? `strict`: a piece built at run time only fills a parameter
 * (/todos/* is /todos/{todo}, not /todos/create). */
function pathFits(ask: string[], route: string[], strict: boolean): boolean {
  return ask.length === route.length && ask.every((s, i) => s === route[i] || route[i] === "*" || (!strict && s === "*"));
}

/** The classes Laravel's models extend. A class extending one of these, or a model of the workspace, is a model. */
const BASE_MODELS = new Set(
  ["Illuminate\\Database\\Eloquent\\Model", "Illuminate\\Foundation\\Auth\\User", "Illuminate\\Database\\Eloquent\\Relations\\Pivot", "Illuminate\\Database\\Eloquent\\Relations\\MorphPivot", "MongoDB\\Laravel\\Eloquent\\Model", "Jenssegers\\Mongodb\\Eloquent\\Model"].map((x) => x.toLowerCase()),
);

/** The class a Livewire component extends (Volt's class components too). */
const BASE_LIVEWIRE = new Set(["Livewire\\Component", "Livewire\\Volt\\Component"].map((x) => x.toLowerCase()));

/** What no PHP file can see alone, settled once every file is parsed (the facts are changed in place):
 * - Eloquent models become tables (`$table`, else Laravel's snake-plural of the class), and every
 *   call on a model (Todo::all(), $todo->save()) reads or writes that table;
 * - routes/api.php's routes get Laravel's /api prefix (bootstrap/app.php's apiPrefix when it sets one);
 * - each route's controller method, found by its class;
 * - each view() a route returns, found in resources/views. */
export function linkPhp(facts: Record<string, FileFacts>, resolve: PhpResolve, contentOf: (p: string) => string | undefined, areaOf: (p: string) => string): PhpLinks {
  const php = Object.keys(facts).filter((p) => facts[p].php);
  const files = Object.keys(facts);
  const classes = new Map<string, { file: string; cls: PhpFacts["classes"][number] }>();
  for (const p of php) for (const cls of facts[p].php!.classes) classes.set(cls.fqn.toLowerCase(), { file: p, cls });
  const fileOf = (fqn: string, from: string) => classes.get(fqn.toLowerCase())?.file ?? resolve(from, fqn);

  // Models and Livewire components, through any chain of the workspace's own base classes.
  const isA = (bases: Set<string>, fqn: string, depth = 0): boolean => {
    const k = fqn.toLowerCase();
    if (bases.has(k)) return true;
    const c = classes.get(k)?.cls;
    return !!c?.extends && depth < 6 && isA(bases, c.extends, depth + 1);
  };
  const isModel = (fqn: string) => isA(BASE_MODELS, fqn);
  const isLivewire = (fqn: string) => isA(BASE_LIVEWIRE, fqn);
  // A Livewire component is part of the screen: its card is a component, beside the view it renders
  // (render()'s view(), else Laravel's convention resources/views/livewire/<name>.blade.php).
  for (const { file, cls } of classes.values()) {
    if (!cls.extends || !isLivewire(cls.fqn)) continue;
    facts[file].hasJsx = true;
    const name = livewireName(cls.fqn);
    const views = facts[file].php!.views;
    if (name && !views.some((v) => v.line >= cls.line && v.line <= cls.end)) views.push({ name: `livewire.${name}`, line: cls.methods.find((m) => m.name === "render")?.start ?? cls.line });
  }
  const tables = new Map<string, string>(); // model fqn (lower case) → table
  for (const [k, { file, cls }] of classes) {
    if (!cls.extends || !isModel(cls.fqn)) continue;
    const table = cls.table?.name ?? tableNameOf(cls.fqn.split("\\").pop()!);
    tables.set(k, table);
    facts[file].sql.push({ table, op: "define", line: cls.table?.line ?? cls.line });
  }
  // Doctrine: an entity's table (defined where its attributes are read); its repository's calls are on it too.
  for (const [k, { cls }] of classes) {
    if (!cls.entity || !cls.table) continue;
    tables.set(k, cls.table.name);
    if (cls.entity.repository) tables.set(cls.entity.repository.toLowerCase(), cls.table.name);
  }
  for (const [k, { cls }] of classes) {
    const t = cls.entityOf && !tables.has(k) ? tables.get(cls.entityOf.toLowerCase()) : undefined;
    if (t) tables.set(k, t);
  }
  for (const p of php) {
    for (const u of facts[p].php!.modelUses) {
      const table = tables.get(u.cls.toLowerCase());
      if (!table) continue;
      const q: SqlFact = { table, op: u.op, line: u.line };
      if (!facts[p].sql.some((x) => x.table === q.table && x.op === q.op && x.line === q.line)) facts[p].sql.push(q);
    }
  }

  // routes/api.php is loaded under /api (Laravel 11+: bootstrap/app.php `apiPrefix: 'api/v1'` changes it).
  for (const p of php) {
    if (!/(^|\/)routes\/api\.php$/.test(p)) continue;
    const dir = p.slice(0, -"routes/api.php".length);
    const prefix = /apiPrefix\s*:\s*['"]([^'"]*)['"]/.exec(contentOf(`${dir}bootstrap/app.php`) ?? "")?.[1] ?? "api";
    for (const r of facts[p].routes) r.path = joinUri(prefix, r.path);
  }

  const handlers: PhpHandler[] = [];
  for (const p of php) {
    for (const r of facts[p].routes) {
      if (!r.controller) continue;
      let target = fileOf(r.controller.cls, p);
      const legacy = !!r.controller.legacy;
      if (!target && legacy) {
        // 'TodoController@index' with no namespace that finds it: the one controller of that name, a guess.
        const short = r.controller.cls.split("\\").pop()!.toLowerCase();
        const named = [...classes.values()].filter((c) => c.cls.fqn.split("\\").pop()!.toLowerCase() === short);
        if (named.length === 1) target = named[0].file;
      }
      if (!target || !facts[target]) continue;
      const cls = facts[target].php?.classes.find((c) => c.fqn.toLowerCase() === r.controller!.cls.toLowerCase()) ?? facts[target].php?.classes[0];
      // A full-page Livewire component (Route::get('/todos', TodoList::class)) answers with its render().
      const page = r.controller.method === "__invoke" && !!cls && isLivewire(cls.fqn) && !cls.methods.some((x) => x.name === "__invoke");
      const method = page ? "render" : r.controller.method;
      if (page) r.handler = cls!.fqn.split("\\").pop();
      const m = cls?.methods.length ? cls.methods.find((x) => x.name.toLowerCase() === method.toLowerCase()) : facts[target].fns.find((x) => x.name.toLowerCase() === method.toLowerCase());
      const h: PhpHandler = { file: p, route: r, target, method, confidence: legacy ? "likely" : "certain" };
      if (m) {
        h.start = m.start;
        h.end = m.end;
      }
      if (legacy) h.note = `'${r.handler}' names no namespace; I took it to be ${target}, as Laravel before version 8 did (App\\Http\\Controllers)`;
      handlers.push(h);
    }
  }

  const views: PhpLinks["views"] = [];
  for (const p of php) {
    for (const v of facts[p].php!.views) {
      const target = viewFile(files, areaOf, p, v.name, v.inertia);
      if (!target) continue;
      // A line in a controller method is run by the routes that name that method; a route file's line by its own route.
      const routes = handlers.filter((h) => h.target === p && h.start !== undefined && v.line >= h.start && v.line <= h.end!).map((h) => h.route);
      // A Livewire component's view is its own too, wherever the component is put on a page.
      const own = facts[p].php!.classes.some((c) => v.line >= c.line && v.line <= c.end && !!c.extends && isLivewire(c.fqn));
      views.push({ file: p, line: v.line, target, routes, ...(own ? { own } : {}) });
    }
  }

  // Livewire: `wire:click="save"` in a component's view runs the component's save().
  const wires: PhpLinks["wires"] = [];
  for (const { file, cls } of classes.values()) {
    if (!cls.extends || !isLivewire(cls.fqn)) continue;
    for (const v of views.filter((x) => x.file === file && x.line >= cls.line && x.line <= cls.end)) {
      for (const w of facts[v.target]?.php?.wires ?? []) {
        const m = cls.methods.find((x) => x.name === w.method);
        if (m) wires.push({ file: v.target, line: w.line, event: w.event, target: file, method: m.name, start: m.start, end: m.end });
      }
    }
  }

  // Blade forms and links: a route by its name is the one route; by its path, the routes whose path fits
  // and whose method is the form's. A path no route fits is left to the map's own search (a request).
  const requests: PhpLinks["requests"] = [];
  const warnings: string[] = [];
  const allRoutes = php.flatMap((p) => facts[p].routes);
  const methodFits = (r: RouteFact, m: Method) => r.method === m || r.method === "ANY" || m === "ANY";
  for (const p of php) {
    for (const q of facts[p].php!.requests ?? []) {
      const base = { file: p, line: q.line, element: q.element, ...(q.label ? { label: q.label } : {}) };
      const verb = q.element === "a" ? "the link asks for" : "the form sends";
      if (q.name) {
        const named = allRoutes.filter((r) => r.name === q.name);
        const fit = named.filter((r) => methodFits(r, q.method));
        if (fit.length) requests.push({ ...base, routes: fit, confidence: "certain" });
        else if (named.length) requests.push({ ...base, routes: named, confidence: "likely", note: `${verb} ${q.method}, but the route '${q.name}' answers ${[...new Set(named.map((r) => r.method))].join(" and ")}` });
        else warnings.push(`${p}:${q.line} names the route '${q.name}', which I can't find`);
        continue;
      }
      const ask = segsOf(q.path!, false);
      // The routes that fit best: /todos/create is the create page, not /todos/{todo}.
      const best = (rs: RouteFact[]) => {
        const score = (r: RouteFact) => segsOf(r.path, true).filter((s, i) => s !== "*" && s === ask[i]).length;
        const top = Math.max(...rs.map(score));
        return rs.filter((r) => score(r) === top);
      };
      const strict = best(allRoutes.filter((r) => pathFits(ask, segsOf(r.path, true), true)));
      const loose = best(allRoutes.filter((r) => pathFits(ask, segsOf(r.path, true), false)));
      const fit = strict.filter((r) => methodFits(r, q.method));
      if (fit.length) {
        const paths = new Set(fit.map((r) => r.path));
        requests.push({ ...base, routes: fit, confidence: paths.size === 1 ? "certain" : "likely", ...(paths.size > 1 ? { note: `more than one route fits ${q.path}` } : {}) });
        continue;
      }
      const near = loose.filter((r) => methodFits(r, q.method));
      if (near.length) requests.push({ ...base, routes: near, confidence: "likely", note: `${q.path} is built at run time; I matched it by the parts that are written out` });
      else if (strict.length) requests.push({ ...base, routes: strict, confidence: "likely", note: `${verb} ${q.method} to ${q.path}, but the route there answers ${[...new Set(strict.map((r) => r.method))].join(" and ")}` });
      else facts[p].http.push({ url: q.path!, method: q.method, line: q.line, callee: q.element === "a" ? "a href" : "form action", fromVariable: false });
    }
  }
  return { handlers, views, requests, wires, warnings };
}
