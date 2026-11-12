// Where the API is: VITE_API_URL, set when the app is built (nothing in the repo sets it).
export function apiBase(): string {
  return import.meta.env.VITE_API_URL;
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${apiBase()}${path}`, init);
}

export async function health() {
  const r = await fetch(`${apiBase()}/health`);
  return r.ok;
}
