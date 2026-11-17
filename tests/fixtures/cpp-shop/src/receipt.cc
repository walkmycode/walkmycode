#include <iostream>
#include "money.h"
#include "receipt.h"

namespace shop {

void print_receipt(const Cart& cart) {
    std::cout << money::format(money::with_tax(total(cart))) << std::endl;
}

}  // namespace shop
