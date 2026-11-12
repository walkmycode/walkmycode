/**
 * SQL in the page: SQLite compiled to WebAssembly (sql.js), one database per
 * editor, kept between runs so tables made in one run are there in the next,
 * until "Restart". Each statement that returns rows shows as a table.
 */
import type { Database, SqlJsStatic } from "sql.js";
import type { OutPart } from "./python";

type Listener = { onPart: (p: OutPart) => void; onStatus: (s: string) => void; done: () => void };

let engine: Promise<SqlJsStatic> | null = null;
const databases = new Map<string, Database>();

function load() {
  // In the artifact the wasm sits beside the page; in the app it is served from /sql/.
  const base = "claude" in window ? new URL("./sql/", document.baseURI).href : new URL("/sql/", location.origin).href;
  engine ??= import("sql.js").then((m) => m.default({ locateFile: (f: string) => base + f.replace(/^sql-wasm\.wasm$/, "sql-wasm-browser.wasm") }));
  return engine;
}

export async function runSql(code: string, l: Listener, dbKey: string) {
  try {
    l.onStatus("Opening the database…");
    const SQL = await load();
    let db = databases.get(dbKey);
    if (!db) {
      db = new SQL.Database();
      databases.set(dbKey, db);
    }
    l.onStatus("");
    const before = db.getRowsModified();
    const results = db.exec(code);
    for (const r of results) {
      l.onPart({ kind: "table", columns: r.columns, rows: r.values.map((row) => row.map((v) => (v === null ? "NULL" : v instanceof Uint8Array ? `<${v.length} bytes>` : String(v)))) });
    }
    if (!results.length) {
      const changed = db.getRowsModified() - before;
      l.onPart({ kind: "out", text: changed > 0 ? `Done. ${changed} row${changed === 1 ? "" : "s"} changed.\n` : "Done.\n" });
    }
  } catch (e) {
    l.onPart({ kind: "error", text: String((e as Error)?.message ?? e) });
  } finally {
    l.onStatus("");
    l.done();
  }
}

/** Forget every table: the next run starts with an empty database. */
export function resetSql(dbKey: string) {
  databases.get(dbKey)?.close();
  databases.delete(dbKey);
}
