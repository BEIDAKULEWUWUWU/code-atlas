/* The only place that talks to the network. Everything above this file deals in values and
   exceptions, never in status codes — a caller that has to remember that a 204 has no body is a
   caller that will eventually forget. */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/* Relative by default: the dev server proxies /api and in production both halves share an
   origin, so there is no host to configure. The override exists for the case where the API is
   somewhere else entirely. */
const BASE = import.meta.env.VITE_API_BASE ?? '';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
  });

  if (response.status === 401) {
    onUnauthorized?.();
    throw new ApiError('signed out', 401);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(body || response.statusText, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
