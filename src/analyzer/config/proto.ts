// .proto files: each `service Users { rpc GetUser(...) ... }` is a gRPC
// service, with its methods and the line it is declared on. Read line by
// line; nothing here is ever run or tree-sitter parsed.
import type { ConfigFacts } from "./types";

export function readProto(path: string, content: string): ConfigFacts["rpcServices"] {
  const out: ConfigFacts["rpcServices"] = [];
  // Comments out, line count kept, so the line numbers stay right.
  const clean = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  const lines = clean.split("\n");
  let current: ConfigFacts["rpcServices"][number] | null = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const svc = /^\s*service\s+(\w+)\s*\{?/.exec(l);
    if (svc && !current) {
      current = { name: svc[1], methods: [], file: path, line: i + 1 };
      out.push(current);
      depth = 0;
    }
    if (current) {
      for (const m of l.matchAll(/\brpc\s+(\w+)\s*\(/g)) if (!current.methods.includes(m[1])) current.methods.push(m[1]);
      for (const ch of l) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth <= 0) {
            current = null;
            break;
          }
        }
      }
    }
  }
  return out;
}
