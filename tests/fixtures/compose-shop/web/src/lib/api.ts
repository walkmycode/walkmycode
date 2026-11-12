// Server-side helpers: they talk to the users and orders services by their
// base URLs from the environment.
const BASE = process.env.ORDERS_URL;

export async function createOrder(uid: number) {
  const r = await fetch(`${BASE}/orders`, { method: "POST", body: JSON.stringify({ uid }) });
  return r.json();
}

export async function getUser(id: number) {
  const r = await fetch(`${process.env.USERS_URL}/users/${id}`);
  return r.json();
}
