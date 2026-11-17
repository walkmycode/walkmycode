#pragma once
#include <string>
#include <vector>
#include "basket.hpp"

namespace shop {

struct Line {
    std::string sku;
    int cents;
};

class Cart : public Basket {
  public:
    void add(const std::string& sku, int cents);
    int count() const { return static_cast<int>(lines.size()); }
    static Cart empty();
    const std::vector<Line>& all() const { return lines; }

  private:
    std::vector<Line> lines;
};

int total(const Cart& cart);

}  // namespace shop
