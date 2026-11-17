#pragma once
#include <string>

namespace shop {

/** What any basket can do; a Cart is one. */
class Basket {
  public:
    void note(const std::string& text);
    bool noted() const { return !memo.empty(); }

  private:
    std::string memo;
};

}  // namespace shop
