#include <stdio.h>
#include <stock.h>
#include "db.h"

int main(void) {
    Item screws = {"screws", 0};
    if (db_open()) return 1;
    stock_add(&screws, 40);
    db_save(&screws);
    printf("%d\n", stock_total(&screws, 1));
    return 0;
}
