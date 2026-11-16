pub mod orders;
pub mod users;

use axum::Router;
use crate::db::Db;

/// Every API route, mounted under /api by main.
pub fn api() -> Router<Db> {
    Router::new()
        .merge(users::router())
        .nest("/orders", orders::router())
}
