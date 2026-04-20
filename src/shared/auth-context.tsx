"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthSessionSnapshot } from "@/types/desktop-api";

type SessionStatus = "loading" | "unauthenticated" | "authenticated" | "bridge-missing";

interface AuthContextValue {
  status: SessionStatus;
  session: AuthSessionSnapshot;
  login: (input: {
    email: string;
    password: string;
    tenantSlug?: string;
    backendHttpBase: string;
  }) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    tenantSlug?: string;
    tenantName?: string;
    name?: string;
    backendHttpBase: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const UNAUTHENTICATED_SESSION: AuthSessionSnapshot = {
  isAuthenticated: false,
  user: null,
  membership: null,
  tenant: null,
  accessExpiresAt: null,
  refreshExpiresAt: null,
  backendHttpBase: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [session, setSession] = useState<AuthSessionSnapshot>(
    UNAUTHENTICATED_SESSION,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySnapshot = useCallback((next: AuthSessionSnapshot) => {
    if (!mountedRef.current) return;
    setSession(next);
    setStatus(next.isAuthenticated ? "authenticated" : "unauthenticated");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktopApi = window.desktopApi;
    if (!desktopApi || typeof desktopApi.getAuthSession !== "function") {
      setStatus("bridge-missing");
      return;
    }
    void desktopApi
      .getAuthSession()
      .then((snapshot) => applySnapshot(snapshot))
      .catch(() => {
        setStatus("unauthenticated");
        setSession(UNAUTHENTICATED_SESSION);
      });
    const unsubscribe = desktopApi.onAuthSessionUpdated((snapshot) => {
      applySnapshot(snapshot);
    });
    return () => {
      unsubscribe();
    };
  }, [applySnapshot]);

  const login = useCallback<AuthContextValue["login"]>(async (input) => {
    const api = window.desktopApi;
    if (!api) throw new Error("desktop bridge unavailable");
    const snapshot = await api.authLogin(input);
    applySnapshot(snapshot);
  }, [applySnapshot]);

  const register = useCallback<AuthContextValue["register"]>(async (input) => {
    const api = window.desktopApi;
    if (!api) throw new Error("desktop bridge unavailable");
    const snapshot = await api.authRegister(input);
    applySnapshot(snapshot);
  }, [applySnapshot]);

  const logout = useCallback<AuthContextValue["logout"]>(async () => {
    const api = window.desktopApi;
    if (!api) return;
    await api.authLogout();
    applySnapshot(UNAUTHENTICATED_SESSION);
  }, [applySnapshot]);

  const refresh = useCallback<AuthContextValue["refresh"]>(async () => {
    const api = window.desktopApi;
    if (!api) return;
    const snapshot = await api.authRefresh();
    applySnapshot(snapshot);
  }, [applySnapshot]);

  const getAccessToken = useCallback<
    AuthContextValue["getAccessToken"]
  >(async () => {
    const api = window.desktopApi;
    if (!api) return null;
    return api.getAccessToken();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, login, register, logout, refresh, getAccessToken }),
    [status, session, login, register, logout, refresh, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
