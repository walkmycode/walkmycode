#ifndef STOCK_H
#define STOCK_H

#define STOCK_MAX 64

typedef struct Item {
    char name[32];
    int count;
} Item;

/* Add `count` of an item; returns the new count. */
int stock_add(Item *item, int count);
int stock_total(const Item *items, int n);

#endif
