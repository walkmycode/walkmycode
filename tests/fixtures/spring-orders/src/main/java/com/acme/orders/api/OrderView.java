package com.acme.orders.api;

import com.acme.orders.data.Order;

/** What the API shows of an order. */
record OrderView(Long id, long totalCents) {
    static OrderView of(Order order) {
        return new OrderView(order.getId(), order.getTotalCents());
    }
}
