/**
 * The JavaScript/TypeScript debugger: record-and-replay, like Python's.
 *
 * The code (already JavaScript; Sucrase keeps TypeScript's line numbers) is
 * parsed with acorn, and a recording call is added before every statement
 * in a block: `__lh.s(line, locals)`, where `locals` reads the variables of
 * the function it is in. Function bodies are wrapped to keep a call stack.
 * Every insertion goes on the line it belongs to, never adding a line, so
 * line numbers and error positions stay the student's own.
 *
 * The run ends by posting the same shape as the Python debugger
 * (public/py/debugger.py), so the same DebugPanel shows it.
 */
import { parse, type Node } from "acorn";
import { ancestor } from "acorn-walk";

type AnyNode = Node & Record<string, unknown>;
type Insert = { at: number; text: string; order: number };

const SKIP = new Set(["FunctionDeclaration", "ClassDeclaration", "ImportDeclaration", "ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration", "EmptyStatement"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Names bound by a pattern: `a`, `{ a, b: c }`, `[d, ...e]`, `f = 1`. */
function patternNames(p: AnyNode | null | undefined, out: string[] = []): string[] {
  if (!p) return out;
  switch (p.type) {
    case "Identifier":
      out.push(p.name as string);
      break;
    case "ObjectPattern":
      for (const prop of p.properties as AnyNode[]) patternNames((prop.type === "RestElement" ? prop.argument : prop.value) as AnyNode, out);
      break;
    case "ArrayPattern":
      for (const el of p.elements as (AnyNode | null)[]) patternNames(el, out);
      break;
    case "RestElement":
      patternNames(p.argument as AnyNode, out);
      break;
    case "AssignmentPattern":
      patternNames(p.left as AnyNode, out);
      break;
  }
  return out;
}

/** The nearest function around a node (by its ancestors), or the program. */
function scopeOf(ancestors: AnyNode[], self?: AnyNode): AnyNode {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a !== self && FUNCTIONS.has(a.type)) return a;
  }
  return ancestors[0];
}

function functionName(fn: AnyNode, parent: AnyNode | undefined): string {
  const id = fn.id as AnyNode | null;
  if (id?.name) return id.name as string;
  if (parent?.type === "VariableDeclarator" && (parent.id as AnyNode)?.type === "Identifier") return (parent.id as AnyNode).name as string;
  if ((parent?.type === "Property" || parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && (parent.key as AnyNode)?.type === "Identifier") {
    return (parent.key as AnyNode).name as string;
  }
  if (parent?.type === "AssignmentExpression" && (parent.left as AnyNode)?.type === "Identifier") return (parent.left as AnyNode).name as string;
  return "(anonymous)";
}

const getter = (names: Iterable<string>) => {
  const list = [...new Set(names)].filter((n) => !n.startsWith("__lh"));
  return list.length ? `(g)=>{${list.map((n) => `g(${JSON.stringify(n)},()=>${n});`).join("")}}` : "null";
};

/** The student's JavaScript with the recording calls added. Throws acorn's SyntaxError for code it cannot read. */
export function instrument(js: string): string {
  const ast = parse(js, { ecmaVersion: "latest", sourceType: "module", locations: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) as unknown as AnyNode;
  const scopes = new Map<AnyNode, Set<string>>([[ast, new Set()]]);
  const bind = (scope: AnyNode, names: string[]) => {
    const set = scopes.get(scope) ?? new Set<string>();
    for (const n of names) set.add(n);
    scopes.set(scope, set);
  };

  // 1. Which names each function (and the program) declares.
  ancestor(ast as unknown as Node, {
    VariableDeclarator(n, _s, anc) {
      bind(scopeOf(anc as unknown as AnyNode[]), patternNames((n as unknown as AnyNode).id as AnyNode));
    },
    FunctionDeclaration(n, _s, anc) {
      const id = (n as unknown as AnyNode).id as AnyNode | null;
      if (id) bind(scopeOf(anc as AnyNode[], n as unknown as AnyNode), [id.name as string]);
    },
    ClassDeclaration(n, _s, anc) {
      const id = (n as unknown as AnyNode).id as AnyNode | null;
      if (id) bind(scopeOf(anc as unknown as AnyNode[]), [id.name as string]);
    },
    CatchClause(n, _s, anc) {
      bind(scopeOf(anc as unknown as AnyNode[]), patternNames((n as unknown as AnyNode).param as AnyNode));
    },
    Function(n) {
      const f = n as unknown as AnyNode;
      bind(f, (f.params as AnyNode[]).flatMap((p) => patternNames(p)));
    },
  });

  /** let/const/class names of the blocks and loop headers around a statement, inside its function. */
  const blockNames = (anc: AnyNode[], scope: AnyNode) => {
    const names: string[] = [];
    for (let i = anc.length - 1; i >= 0 && anc[i] !== scope; i--) {
      const a = anc[i];
      const decl = (d: AnyNode | null | undefined) => {
        if (d?.type === "VariableDeclaration" && d.kind !== "var") for (const v of d.declarations as AnyNode[]) patternNames(v.id as AnyNode, names);
      };
      if (a.type === "ForStatement") decl(a.init as AnyNode);
      else if (a.type === "ForInStatement" || a.type === "ForOfStatement") decl(a.left as AnyNode);
      else if (a.type === "BlockStatement" || a.type === "SwitchCase") {
        for (const st of (a.type === "BlockStatement" ? a.body : a.consequent) as AnyNode[]) {
          decl(st);
          if (st.type === "ClassDeclaration" && st.id) names.push((st.id as AnyNode).name as string);
        }
      }
    }
    return names;
  };

  const inserts: Insert[] = [];
  const stepBefore = (stmt: AnyNode, anc: AnyNode[]) => {
    if (SKIP.has(stmt.type)) return;
    const scope = scopeOf(anc);
    const line = (stmt.loc as { start: { line: number } }).start.line;
    const inner = blockNames(anc, scope);
    // At the top level these are shown with the program's variables (the harness merges them).
    const locals = scope === ast ? getter(inner) : getter([...(scopes.get(scope) ?? []), ...inner]);
    inserts.push({ at: stmt.start, text: `__lh.s(${line},${locals});`, order: 1 });
  };

  // 2. A recording call before each statement in a block, and a stack frame around each function body.
  ancestor(ast as unknown as Node, {
    Program(n) {
      for (const s of (n as unknown as AnyNode).body as AnyNode[]) stepBefore(s, [n as unknown as AnyNode]);
    },
    BlockStatement(n, _s, anc) {
      for (const s of (n as unknown as AnyNode).body as AnyNode[]) stepBefore(s, [...(anc as unknown as AnyNode[])]);
    },
    SwitchCase(n, _s, anc) {
      for (const s of (n as unknown as AnyNode).consequent as AnyNode[]) stepBefore(s, [...(anc as unknown as AnyNode[])]);
    },
    Function(n, _s, anc) {
      const f = n as unknown as AnyNode;
      const body = f.body as AnyNode;
      if (body.type !== "BlockStatement") return; // an arrow's single expression is not stepped
      const list = anc as unknown as AnyNode[];
      const parent = list[list.length - 2];
      const name = functionName(f, parent);
      inserts.push({ at: body.start + 1, text: `__lh.e(${JSON.stringify(name)});try{`, order: 0 });
      inserts.push({ at: body.end - 1, text: `}finally{__lh.x()}`, order: 2 });
    },
  });

  // 3. The program's own variables, readable from any step; then splice, last first.
  const globals = `const __lhG=${getter(scopes.get(ast) ?? [])};`;
  inserts.push({ at: 0, text: globals, order: -1 });
  inserts.sort((a, b) => b.at - a.at || b.order - a.order);
  let out = js;
  for (const ins of inserts) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  return out;
}

/**
 * The debug harness, one statement per line (the line count is subtracted
 * from error positions). It keeps output in a buffer, records each step,
 * and posts {type:"debug", data} when the run ends, stops or fails.
 */
export const DEBUG_HARNESS = [
  `const __lhFmt = (v, d = 0) => { if (typeof v === "string") return JSON.stringify(v); if (typeof v === "function") return "[Function " + (v.name || "anonymous") + "]"; if (typeof v === "bigint") return v + "n"; if (v === undefined) return "undefined"; if (v instanceof Error) return v.name + ": " + v.message; if (v instanceof Map) return "Map(" + v.size + ")"; if (v instanceof Set) return "Set(" + v.size + ") {" + [...v].slice(0, 20).map((x) => __lhFmt(x, d + 1)).join(", ") + "}"; if (Array.isArray(v)) return d > 2 ? "[Array]" : "[" + v.slice(0, 50).map((x) => __lhFmt(x, d + 1)).join(", ") + (v.length > 50 ? ", …" : "") + "]"; if (v && typeof v === "object") { if (d > 2) return "{…}"; return "{" + Object.entries(v).slice(0, 30).map(([k, x]) => k + ": " + __lhFmt(x, d + 1)).join(", ") + "}"; } return String(v); };`,
  `const __lhType = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? (v.constructor && v.constructor.name) || "object" : typeof v;`,
  `const __lh = { steps: [], stack: [], out: "", stopped: false, max: 2000, snap(fn) { if (!fn) return null; const vars = {}; fn((name, read) => { try { const v = read(); if (typeof v === "function") return; const s = __lhFmt(v); vars[name] = [s.length > 300 ? s.slice(0, 297) + "..." : s, __lhType(v)]; } catch {} }); return vars; }, s(line, locals) { if (this.stopped) throw new Error("__lh_stop"); if (this.steps.length >= this.max) { this.stopped = true; throw new Error("__lh_stop"); } this.steps.push({ event: "line", line, stack: this.stack.length ? ["<module>", ...this.stack] : ["<module>"], locals: this.stack.length ? this.snap(locals) : null, globals: Object.assign(this.snap(typeof __lhG === "function" ? __lhG : null) || {}, this.stack.length ? {} : this.snap(locals) || {}), out: this.out.length, ret: null }); }, e(name) { this.stack.push(name); }, x() { this.stack.pop(); }, sent: false, send(error) { if (this.sent) return; this.sent = true; self.postMessage({ type: "debug", data: { steps: this.steps, output: this.out, error: this.stopped ? null : error, truncated: this.stopped, maxSteps: this.max } }); self.postMessage({ type: "done" }); } };`,
  `const __lhLine = (a) => a.map((x) => typeof x === "string" ? x : __lhFmt(x)).join(" ") + "\\n"; console.log = console.info = console.debug = console.warn = console.error = (...a) => { __lh.out += __lhLine(a); }; console.table = (d) => { __lh.out += __lhFmt(d) + "\\n"; };`,
  `self.addEventListener("error", (e) => { e.preventDefault(); const own = e.lineno > __LH_HEADER ? "Line " + (e.lineno - __LH_HEADER) + ": " : ""; __lh.send(String(e.message || "").includes("__lh_stop") ? null : own + (e.message || "The code stopped with an error.")); });`,
  `self.addEventListener("unhandledrejection", (e) => { e.preventDefault(); const m = e.reason && e.reason.message ? e.reason.message : String(e.reason); __lh.send(m.includes("__lh_stop") ? null : "Uncaught (in promise): " + m); });`,
];
export const DEBUG_END = `\n;__lh.send(null);\n`;
