import { EventEmitter } from "node:events";
import { DesktopAuthStorage, PersistedAuthSession } from "./auth-storage.ts";

interface LoginInput {
  email: string;
  password: string;
  tenantSlug?: string;
  backendHttpBase: string;
}

interface RegisterInput extends LoginInput {
  tenantName?: string;
  name?: string;
}

/** Shape returned by backend `/auth/login`, `/auth/register`, `/auth/refresh`. */
interface BackendAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  tokenType: "Bearer";
  user: {
    id: string;
    tenantId: string;
    email: string;
    name: string | null;
    role: string;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
}

export interface SessionSnapshot {
  isAuthenticated: boolean;
  user: BackendAuthSession["user"] | null;
  tenant: BackendAuthSession["tenant"] | null;
  accessExpiresAt: number | null;
  refreshExpiresAt: number | null;
  backendHttpBase: string | null;
}

/** Refresh this many seconds before `access_token` expires. */
const PROACTIVE_REFRESH_WINDOW_SECONDS = 60;

export class DesktopAuthService extends EventEmitter {
  private readonly storage = new DesktopAuthStorage();
  private session: PersistedAuthSession | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private inFlightRefresh: Promise<string | null> | null = null;

  constructor() {
    super();
  }

  /** Load persisted session (if any) on main-process startup. */
  hydrate(): SessionSnapshot {
    const loaded = this.storage.load();
    if (loaded) {
      this.session = loaded;
      this.scheduleProactiveRefresh();
    }
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    if (!this.session) {
      return {
        isAuthenticated: false,
        user: null,
        tenant: null,
        accessExpiresAt: null,
        refreshExpiresAt: null,
        backendHttpBase: null,
      };
    }
    return {
      isAuthenticated: true,
      user: this.session.user,
      tenant: this.session.tenant,
      accessExpiresAt: this.session.accessExpiresAt,
      refreshExpiresAt: this.session.refreshExpiresAt,
      backendHttpBase: this.session.backendHttpBase,
    };
  }

  async login(input: LoginInput): Promise<SessionSnapshot> {
    const response = await fetchBackend(
      input.backendHttpBase,
      "/auth/login",
      {
        email: input.email,
        password: input.password,
        tenantSlug: input.tenantSlug,
      },
    );
    this.assignSession(response, input.backendHttpBase);
    return this.snapshot();
  }

  async register(input: RegisterInput): Promise<SessionSnapshot> {
    const response = await fetchBackend(
      input.backendHttpBase,
      "/auth/register",
      {
        email: input.email,
        password: input.password,
        tenantSlug: input.tenantSlug,
        tenantName: input.tenantName,
        name: input.name,
      },
    );
    this.assignSession(response, input.backendHttpBase);
    return this.snapshot();
  }

  /**
   * Return a valid access token, refreshing proactively if within the
   * `PROACTIVE_REFRESH_WINDOW_SECONDS` expiration buffer.
   *
   * This is the single path by which renderer-facing code or main-process
   * clients (feedback socket, WS egress) obtain a token. The raw token is
   * never exposed over IPC except on explicit `auth:get-access-token` calls.
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null;
    const nowMs = Date.now();
    const refreshThresholdMs =
      this.session.accessExpiresAt - PROACTIVE_REFRESH_WINDOW_SECONDS * 1000;
    if (nowMs >= refreshThresholdMs) {
      return this.refreshAccessToken();
    }
    return this.session.accessToken;
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.session) return null;
    if (this.inFlightRefresh) return this.inFlightRefresh;

    const session = this.session;
    this.inFlightRefresh = (async () => {
      try {
        const response = await fetchBackend(
          session.backendHttpBase,
          "/auth/refresh",
          { refreshToken: session.refreshToken },
        );
        this.assignSession(response, session.backendHttpBase);
        return this.session?.accessToken ?? null;
      } catch (err) {
        // Refresh failed — clear session and force login.
        await this.logout().catch(() => undefined);
        throw err;
      } finally {
        this.inFlightRefresh = null;
      }
    })();
    return this.inFlightRefresh;
  }

  async logout(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.storage.clear();
    this.emit("session-updated", this.snapshot());

    if (session) {
      try {
        await fetch(`${session.backendHttpBase}/auth/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
      } catch {
        /* best-effort; server cleanup can happen out-of-band */
      }
    }
  }

  private assignSession(
    backendSession: BackendAuthSession,
    backendHttpBase: string,
  ): void {
    this.session = {
      accessToken: backendSession.accessToken,
      refreshToken: backendSession.refreshToken,
      accessExpiresAt: backendSession.accessExpiresAt,
      refreshExpiresAt: backendSession.refreshExpiresAt,
      tokenType: backendSession.tokenType,
      user: backendSession.user,
      tenant: backendSession.tenant,
      backendHttpBase,
    };
    try {
      this.storage.save(this.session);
    } catch (err) {
      // Keep session in memory but surface the issue — the renderer should
      // warn the user that tokens are volatile.
      this.emit(
        "persistence-error",
        err instanceof Error ? err.message : String(err),
      );
    }
    this.scheduleProactiveRefresh();
    this.emit("session-updated", this.snapshot());
  }

  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.session) return;
    const nowMs = Date.now();
    const refreshAt =
      this.session.accessExpiresAt - PROACTIVE_REFRESH_WINDOW_SECONDS * 1000;
    const delay = Math.max(5_000, refreshAt - nowMs);
    this.refreshTimer = setTimeout(() => {
      void this.refreshAccessToken().catch(() => undefined);
    }, delay);
  }
}

async function fetchBackend(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<BackendAuthSession> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) message = payload.message;
    } catch {
      /* ignore JSON parse errors */
    }
    throw new Error(message);
  }
  return (await response.json()) as BackendAuthSession;
}
