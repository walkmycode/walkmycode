#include <assert.h>
#include "stock.h"

int main(void) {
    Item i = {"x", 0};
    assert(stock_add(&i, 2) == 2);
    return 0;
}
