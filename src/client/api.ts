// HTTP API client (contracts/net.ts): accounts, sessions and the character list. JSON in, JSON out, the session
// token as a Bearer header. Errors surface as ApiError with the server's player-facing text.
import type { AuthResponse, CharacterSummary, MeResponse } from '../contracts/net';

export class ApiError extends Error {
  /** HTTP status, or 0 when the server could not be reached at all. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /** The session token is missing, expired or revoked. */
  get unauthorized(): boolean {
    return this.status === 401;
  }

  /** The request never got an HTTP answer (server down, network gone). */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

export const UNREACHABLE_TEXT = 'The server cannot be reached. Check your connection and try again.';
/** A request without an answer for this long counts as unreachable (a proxy that accepts but never answers). */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface ApiClient {
  register(username: string, password: string): Promise<AuthResponse>;
  login(username: string, password: string): Promise<AuthResponse>;
  logout(): Promise<void>;
  me(): Promise<MeResponse>;
  createCharacter(name: string): Promise<CharacterSummary>;
  deleteCharacter(id: string): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Player-facing text for a failed response: the server's `{ error }`, else a sensible default per status. */
export function errorText(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    const text = (body as { error: string }).error.trim();
    if (text) return text;
  }
  if (status === 401) return 'Your session has ended. Please log in again.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status >= 500) return 'The server ran into a problem. Please try again.';
  return 'The request failed. Please try again.';
}

export function createApi(
  getToken: () => string | null,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
  base = '',
  timeoutMs = REQUEST_TIMEOUT_MS,
): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Without a deadline a hung server would leave the auth screens busy forever.
    const abort = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : null;
    let res: Response;
    let data: unknown = null;
    try {
      try {
        res = await fetchImpl(base + path, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort?.signal,
        });
      } catch {
        throw new ApiError(0, UNREACHABLE_TEXT);
      }
      try {
        data = await res.json();
      } catch {
        // A timeout while reading the body, or not JSON at all.
        if (abort?.signal.aborted) throw new ApiError(0, UNREACHABLE_TEXT);
        data = null;
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    // A dev proxy answers 5xx with an HTML page when the game server is down: treat that as unreachable.
    if (!res.ok && data === null && (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500)) {
      throw new ApiError(0, UNREACHABLE_TEXT);
    }
    if (!res.ok) throw new ApiError(res.status, errorText(res.status, data));
    if (data === null || typeof data !== 'object') throw new ApiError(res.status, 'The server sent an unexpected answer.');
    return data as T;
  }

  return {
    register: (username, password) => request<AuthResponse>('POST', '/api/register', { username, password }),
    login: (username, password) => request<AuthResponse>('POST', '/api/login', { username, password }),
    async logout() {
      await request<{ ok: true }>('POST', '/api/logout');
    },
    me: () => request<MeResponse>('GET', '/api/me'),
    async createCharacter(name) {
      const r = await request<{ character: CharacterSummary }>('POST', '/api/characters', { name });
      return r.character;
    },
    async deleteCharacter(id) {
      await request<{ ok: true }>('DELETE', `/api/characters/${encodeURIComponent(id)}`);
    },
  };
}
