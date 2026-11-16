use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;

use super::super::payments;
use crate::db::Db;

#[derive(Deserialize)]
pub struct NewOrder {
    pub user_id: i64,
    pub total_pence: i64,
}

pub fn router() -> Router<Db> {
    Router::new().route("/", post(create_order))
}

async fn create_order(State(pool): State<Db>, Json(order): Json<NewOrder>) -> &'static str {
    payments::charge(order.total_pence).await;
    sqlx::query("INSERT INTO orders (user_id, total_pence) VALUES ($1, $2)")
        .bind(order.user_id)
        .bind(order.total_pence)
        .execute(&pool)
        .await
        .unwrap();
    "created"
}
