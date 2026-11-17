package com.acme.orders.client;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;

public class AuditClient {
    private final OkHttpClient http = new OkHttpClient();

    public void placed(Long orderId) throws java.io.IOException {
        Request request = new Request.Builder()
            .url("https://hooks.slack.com/services/orders")
            .post(RequestBody.create("placed " + orderId, null))
            .build();
        http.newCall(request).execute();
    }
}
