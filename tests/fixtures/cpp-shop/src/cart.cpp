#include "cart.hpp"

namespace shop {

namespace {
int clamp(int cents) { return cents < 0 ? 0 : cents; }
}  // namespace

void Cart::add(const std::string& sku, int cents) {
    lines.push_back({sku, clamp(cents)});
}

Cart Cart::empty() {
    return Cart();
}

int total(const Cart& cart) {
    int sum = 0;
    for (const auto& l : cart.all()) sum += l.cents;
    return sum;
}

}  // namespace shop
