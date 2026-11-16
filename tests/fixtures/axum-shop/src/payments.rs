//! Card payments through Stripe's API.
const STRIPE_API: &str = "https://api.stripe.com/v1";

pub async fn charge(amount_pence: i64) {
    let key = std::env::var("STRIPE_SECRET_KEY").unwrap_or_default();
    let client = reqwest::Client::new();
    client
        .post(format!("{}/charges", STRIPE_API))
        .bearer_auth(key)
        .form(&[("amount", amount_pence.to_string()), ("currency", "gbp".to_string())])
        .send()
        .await
        .unwrap();
}
