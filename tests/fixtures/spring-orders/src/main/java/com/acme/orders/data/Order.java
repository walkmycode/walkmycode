package com.acme.orders.data;

import jakarta.persistence.*;

@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    private long totalCents;

    @OneToMany(mappedBy = "order")
    private java.util.List<OrderLine> lines;

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public long getTotalCents() {
        return totalCents;
    }
}
