// The shapes the pages get back from the API.
export type TaskRow = { id: string; title: string; done: boolean; assignee: { id: string; name: string } | null };
export type ProjectRow = { id: string; name: string; tasks: number };
export type CommentRow = { id: string; body: string; author: { name: string } };

/** The API's error message, or a plain one. */
export async function errorOf(r: Response): Promise<string> {
  const body = await r.json().catch(() => null);
  return body?.error ?? `Request failed (${r.status})`;
}
