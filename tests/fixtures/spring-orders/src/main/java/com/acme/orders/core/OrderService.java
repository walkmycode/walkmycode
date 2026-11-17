package com.acme.orders.core;

import com.acme.orders.client.AuditClient;
import com.acme.orders.client.PaymentClient;
import com.acme.orders.client.UserClient;
import com.acme.orders.data.*;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class OrderService {
    private final OrderRepository repo;
    private final UserClient users;
    private final PaymentClient payments;
    private final AuditClient audit = new AuditClient();

    public List<Order> all() {
        return repo.findAll();
    }

    public Order find(Long id) {
        return repo.findById(id).orElseThrow();
    }

    public Order place(Order order, Customer customer) throws java.io.IOException {
        users.check(order.getUserId());
        payments.charge(order.getTotalCents());
        audit.placed(order.getId());
        customer.getFullName();
        return repo.save(order);
    }

    public void cancel(Long id) {
        repo.deleteById(id);
    }
}
