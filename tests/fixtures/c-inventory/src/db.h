#ifndef DB_H
#define DB_H

#include <stock.h>

int db_open(void);
int db_save(const Item *item);
int db_count(void);

#endif
