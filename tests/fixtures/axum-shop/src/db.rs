use serde::{Deserialize, Serialize};
use sqlx::PgPool;

pub type Db = PgPool;

#[derive(Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub name: String,
}

pub async fn connect() -> Db {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    PgPool::connect(&url).await.unwrap()
}

pub async fn all_users(pool: &Db) -> Vec<User> {
    sqlx::query_as::<_, User>("SELECT id, name FROM users").fetch_all(pool).await.unwrap()
}

pub async fn user_by_id(pool: &Db, id: i64) -> User {
    sqlx::query_as::<_, User>("SELECT id, name FROM users WHERE id = $1").bind(id).fetch_one(pool).await.unwrap()
}

pub async fn insert_user(pool: &Db, name: &str) -> User {
    sqlx::query_as::<_, User>("INSERT INTO users (name) VALUES ($1) RETURNING id, name")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub async fn delete_user(pool: &Db, id: i64) {
    sqlx::query("DELETE FROM users WHERE id = $1").bind(id).execute(pool).await.unwrap();
}
