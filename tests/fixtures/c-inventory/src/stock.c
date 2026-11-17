#include "stock.h"

static int clamp(int v) {
    return v < 0 ? 0 : v;
}

int stock_add(Item *item, int count) {
    item->count = clamp(item->count + count);
    return item->count;
}

int stock_total(const Item *items, int n) {
    int total = 0;
    for (int i = 0; i < n; i++) total += items[i].count;
    return total;
}
