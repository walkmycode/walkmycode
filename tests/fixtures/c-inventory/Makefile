CC ?= cc
CFLAGS += -Iinclude

inventory: src/main.c src/stock.c src/db.c
	$(CC) $(CFLAGS) -o $@ $^ -lsqlite3
