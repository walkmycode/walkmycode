package com.acme.orders.data;

import jakarta.persistence.*;

@Entity
public class OrderLine {
    @Id
    private Long id;

    private String sku;

    @ManyToOne
    private Order order;
}
