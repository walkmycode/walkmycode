#include "cart.hpp"
#include "checkout.hpp"
#include "receipt.h"

int main() {
    auto cart = shop::Cart::empty();
    cart.add("tea", 450);
    shop::Cart gift;
    gift.add("card", 100);
    gift.note("wrap it");
    shop::print_receipt(cart);
    shop::Checkout checkout(gift);
    return checkout.pay() + shop::total(cart) > 0 ? 0 : 1;
}
