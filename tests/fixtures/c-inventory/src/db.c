#include <sqlite3.h>
#include <stdlib.h>
#include "db.h"

static sqlite3 *db;

int db_open(void) {
    const char *path = getenv("INVENTORY_DB");
    if (sqlite3_open(path ? path : "inventory.db", &db)) return 1;
    return sqlite3_exec(db, "CREATE TABLE IF NOT EXISTS items (name TEXT PRIMARY KEY, count INTEGER NOT NULL)", 0, 0, 0);
}

int db_save(const Item *item) {
    sqlite3_stmt *st;
    sqlite3_prepare_v2(db, "INSERT INTO items (name, count) "
                           "VALUES (?, ?)", -1, &st, 0);
    sqlite3_bind_text(st, 1, item->name, -1, 0);
    return sqlite3_step(st);
}

int db_count(void) {
    return sqlite3_exec(db, "SELECT COUNT(*) FROM items", 0, 0, 0);
}
