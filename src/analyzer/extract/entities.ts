// Classes that are tables, settled across files (JPA in Java and Kotlin, extract/java.ts and
// extract/kotlin.ts; C#'s EF Core, extract/csharp.ts). A file says "Order is an entity, its table
// is orders" or "DbSet<Order> Orders"; another says "I am a repository of Order" or
// "db.Orders.Add(o)"; a third may name the table (`[Table("orders")]`, `.ToTable("orders")`). Only
// together do they say which table a line reads or writes, so this runs once every file has its
// facts and turns them into the same facts SQL in a string gives: f.sql (define, read, write) and
// f.columns.
import type { FileFacts, SqlFact } from "../facts";

export function linkEntities(facts: Record<string, FileFacts>): void {
  const files = Object.keys(facts).filter((p) => facts[p].entity);
  if (!files.length) return;
  /** A class's table as the code names it apart from the DbSet: `[Table("orders")]`, `.ToTable("orders")`. */
  const named = new Map<string, string>();
  for (const p of files) for (const n of facts[p].entity!.names ?? []) if (!named.has(n.cls)) named.set(n.cls, n.table);
  /** Entity class → its table; a DbSet's name → the table it stands for (its own name, unless the class's table is named). */
  const tableOf = new Map<string, string>();
  const sets = new Map<string, string>();
  for (const p of files) {
    for (const e of facts[p].entity!.entities) {
      if (!e.set) tableOf.set(e.cls, e.table);
      else if (!sets.has(e.table)) sets.set(e.table, named.get(e.cls) ?? e.table);
    }
  }
  // An @Entity's own table wins over a DbSet of the same class name.
  for (const p of files) for (const e of facts[p].entity!.entities) if (e.set && !tableOf.has(e.cls)) tableOf.set(e.cls, sets.get(e.table)!);
  if (!tableOf.size) return;
  // JPQL names the entity, not the table: "select o from Order o" is a read of orders, in any Java or Kotlin file.
  for (const p of Object.keys(facts)) if (/\.(java|kts?)$/.test(p)) for (const q of facts[p].sql) if (tableOf.has(q.table)) q.table = tableOf.get(q.table)!;

  for (const p of files) {
    const f = facts[p];
    const ent = f.entity!;
    const seen = new Set(f.sql.map((q) => `${q.table}|${q.op}|${q.line}`));
    const add = (q: SqlFact) => {
      const k = `${q.table}|${q.op}|${q.line}`;
      if (seen.has(k)) return;
      seen.add(k);
      f.sql.push(q);
    };
    for (const e of ent.entities) add({ table: e.set ? sets.get(e.table)! : e.table, op: "define", line: e.line });
    for (const u of ent.uses) {
      const table = u.cls !== undefined ? tableOf.get(u.cls) : u.set !== undefined ? sets.get(u.set) : undefined;
      if (table) add({ table, op: u.op, line: u.line });
    }
    // The columns are the fields of the class, wherever the class is written.
    for (const [cls, fields] of Object.entries(ent.fields)) {
      const table = tableOf.get(cls);
      if (!table) continue;
      // A field whose type is another entity is a relation, not a column.
      const columns = fields.columns.filter((c) => !tableOf.has((c.type ?? "").replace(/[?[\]]|<.*$/g, "")));
      if (columns.length) (f.columns ??= []).push({ table, columns, line: fields.line });
    }
    f.sql.sort((a, b) => a.line - b.line);
  }
}
