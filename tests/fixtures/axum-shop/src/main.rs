//! A small shop API on axum: users, orders, and card payments through Stripe.
mod db;
mod payments;
mod routes;

use axum::{routing::get, Router};

#[tokio::main]
async fn main() {
    let pool = db::connect().await;
    let app = Router::new()
        .route("/health", get(health))
        .nest("/api", routes::api())
        .with_state(pool);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}
