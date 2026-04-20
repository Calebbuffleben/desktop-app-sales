"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/shared/auth-context";

/**
 * Public acceptance page. Two modes:
 *
 *  - Authenticated user: calls `/invites/accept`. The backend creates a
 *    Membership between the existing user and the invite's tenant. The user
 *    then has to log in with the target tenant's slug to switch.
 *  - Anonymous user: calls `/invites/accept-public` with a fresh password.
 *    Backend creates a User + Membership and returns an access/refresh token
 *    scoped to the invite's tenant.
 */
export default function AcceptInvitePage() {
  return <AcceptInviteScreen />;
}

function AcceptInviteScreen() {
  const router = useRouter();
  const { status, session } = useAuth();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [backendHttpBase, setBackendHttpBase] = useState(
    "http://localhost:3001",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.desktopApi;
    if (!api) return;
    void api.getAuthSession().then((snap) => {
      if (snap.backendHttpBase) setBackendHttpBase(snap.backendHttpBase);
    });
    if (typeof window !== "undefined") {
      const queryToken = new URLSearchParams(window.location.search).get(
        "token",
      );
      if (queryToken) setToken(queryToken);
    }
  }, []);

  async function handleAuthenticated() {
    const api = window.desktopApi;
    if (!api) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.invitesAccept({ token: token.trim() });
      setMessage(
        `Convite aceito! Nova membership em ${res.tenantSlug} (role ${res.role}). Faça logout e login com o slug ${res.tenantSlug} para acessá-lo.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublic() {
    const api = window.desktopApi;
    if (!api) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.invitesAcceptPublic({
        token: token.trim(),
        password,
        name: name.trim() || undefined,
        backendHttpBase: backendHttpBase.trim(),
      });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const isAuthenticated = status === "authenticated";

  const field =
    "mt-1 w-full rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/70";
  const labelCls =
    "block text-xs font-medium uppercase tracking-wider text-zinc-500";

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="relative z-10 w-full max-w-md rounded-2xl border border-cyan-500/20 bg-zinc-900/70 p-7 shadow-[0_0_48px_-16px_rgba(34,211,238,0.25)] backdrop-blur">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400/95">
          Meet Copilot
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Aceitar convite
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          {isAuthenticated
            ? `Logado como ${session.user?.email} (tenant ${session.tenant?.slug}). Aceitar cria uma nova membership — você continuará logado no tenant atual.`
            : "Cole o token recebido do admin. Um novo usuário será criado no tenant convidador."}
        </p>

        <div className="mt-5 space-y-4">
          <label className={labelCls}>
            Token do convite
            <input
              className={field}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          {!isAuthenticated ? (
            <>
              <label className={labelCls}>
                Backend HTTP base
                <input
                  className={field}
                  value={backendHttpBase}
                  onChange={(e) => setBackendHttpBase(e.target.value)}
                  required
                />
              </label>
              <label className={labelCls}>
                Defina sua senha
                <input
                  type="password"
                  className={field}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label className={labelCls}>
                Nome
                <input
                  className={field}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
            </>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-[11px] text-emerald-200">
              {message}
            </div>
          ) : null}

          <button
            type="button"
            onClick={isAuthenticated ? handleAuthenticated : handlePublic}
            disabled={submitting}
            className="w-full rounded-lg border border-cyan-500/45 bg-cyan-600/95 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_22px_-8px_rgba(34,211,238,0.5)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting
              ? "Enviando…"
              : isAuthenticated
                ? "Aceitar convite"
                : "Criar conta e entrar"}
          </button>
        </div>
      </main>
    </div>
  );
}
