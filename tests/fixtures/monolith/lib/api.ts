// Browser-side helper: talks to our own API through the public base URL.
export async function fetchUser(id: string) {
  const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/${id}`);
  return r.json();
}
