package com.acme.orders.data;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Lombok writes the getters and setters: the fields are still the columns. */
@Entity
@Data
@NoArgsConstructor
public class Customer {
    @Id
    private Long id;

    private String fullName;
}
