package com.acme.orders.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Component
public class PaymentClient {
    private final WebClient client;

    public PaymentClient(@Value("${payments.url}") String paymentsUrl) {
        this.client = WebClient.builder().baseUrl(paymentsUrl).build();
    }

    public void charge(long cents) {
        client.post().uri("/charges").bodyValue(cents).retrieve().toBodilessEntity().block();
    }

    public String status(String id) {
        return client.get().uri("/charges/{id}", id).retrieve().bodyToMono(String.class).block();
    }
}
