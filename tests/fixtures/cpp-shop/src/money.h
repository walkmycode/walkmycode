#pragma once
#include <string>

namespace money {

template <typename T>
T with_tax(T cents) {
    return cents + cents / 5;
}

inline std::string format(int cents) {
    return std::to_string(cents / 100) + "." + std::to_string(cents % 100);
}

}  // namespace money
