use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};

use crate::db::{self, Db, User};

pub fn router() -> Router<Db> {
    Router::new()
        .route("/users", get(list_users).post(create_user))
        .route("/users/{id}", get(get_user).delete(delete_user))
}

async fn list_users(State(pool): State<Db>) -> Json<Vec<User>> {
    Json(db::all_users(&pool).await)
}

async fn create_user(State(pool): State<Db>, Json(body): Json<User>) -> Json<User> {
    Json(db::insert_user(&pool, &body.name).await)
}

async fn get_user(State(pool): State<Db>, Path(id): Path<i64>) -> Json<User> {
    Json(db::user_by_id(&pool, id).await)
}

async fn delete_user(State(pool): State<Db>, Path(id): Path<i64>) {
    db::delete_user(&pool, id).await;
}
