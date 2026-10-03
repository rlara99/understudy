// SHARED FILE: tiny fetch helpers for the /api server.

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const getJson = <T>(url: string) => request<T>("GET", url);
export const postJson = <T>(url: string, body: unknown) => request<T>("POST", url, body);
export const putJson = <T>(url: string, body: unknown) => request<T>("PUT", url, body);
