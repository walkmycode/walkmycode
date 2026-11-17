package com.acme.orders.api;

import com.acme.orders.core.OrderService;
import com.acme.orders.data.Customer;
import com.acme.orders.data.Order;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orders;

    public OrderController(OrderService orders) {
        this.orders = orders;
    }

    @GetMapping
    public List<Order> list() {
        return orders.all();
    }

    @GetMapping("/{id}")
    public OrderView one(@PathVariable Long id) {
        return OrderView.of(orders.find(id));
    }

    @PostMapping
    public Order create(@RequestBody Order order) throws java.io.IOException {
        return orders.place(order, new Customer());
    }

    @RequestMapping(value = "/{id}", method = RequestMethod.DELETE)
    public void cancel(@PathVariable Long id) {
        orders.cancel(id);
    }
}
