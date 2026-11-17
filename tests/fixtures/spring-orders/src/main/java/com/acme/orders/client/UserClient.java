package com.acme.orders.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class UserClient {
    @Value("${users.url}")
    private String usersUrl;

    private final RestTemplate rest = new RestTemplate();

    public void check(Long userId) {
        String key = System.getenv("USERS_API_KEY");
        rest.getForObject(usersUrl + "/api/users/" + userId + "?key=" + key, String.class);
    }
}
