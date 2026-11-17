#include "checkout.hpp"
#include "receipt.h"

namespace shop {

Checkout::Checkout(Cart cart) : cart(cart) {}

int Checkout::pay() {
    cart.add("bag", 10);
    saved->add("later", 0);
    print_receipt(cart);
    return cart.count();
}

}  // namespace shop
