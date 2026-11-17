#pragma once
#include <memory>
#include "cart.hpp"

namespace shop {

class Checkout {
  public:
    explicit Checkout(Cart cart);
    int pay();

  private:
    Cart cart;
    std::unique_ptr<Cart> saved;
};

}  // namespace shop
