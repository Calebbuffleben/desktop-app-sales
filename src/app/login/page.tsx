"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/shared/auth-context";
import { LoginGate } from "@/shared/session-gate";

type Mode = "login" | "register";

export default function LoginPage() {
  return (
    <LoginGate>
      <LoginScreen />
    </LoginGate>
  );
}

function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [backendHttpBase, setBackendHttpBase] = useState("http://localhost:3001");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.desktopApi;
    if (!api) return;
    void api.getAuthSession().then((snapshot) => {
      if (snapshot.backendHttpBase) {
        setBackendHttpBase(snapshot.backendHttpBase);
      }
    });
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") {
        await login({
          email: email.trim(),
          password,
          tenantSlug: tenantSlug.trim() || undefined,
          backendHttpBase: backendHttpBase.trim(),
        });
      } else {
        await register({
          email: email.trim(),
          password,
          tenantSlug: tenantSlug.trim() || undefined,
          tenantName: tenantName.trim() || undefined,
          name: displayName.trim() || undefined,
          backendHttpBase: backendHttpBase.trim(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/35";
  const labelCls = "block text-xs font-medium uppercase tracking-wider text-zinc-500";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950 px-4 py-10 text-zinc-100">
      <div
        className="pointer-events-none absolute -left-20 top-10 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-10 right-10 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl"
        aria-hidden
      />
      <main className="relative z-10 w-full max-w-md rounded-2xl border border-cyan-500/20 bg-zinc-900/70 p-7 shadow-[0_0_48px_-16px_rgba(34,211,238,0.25)] backdrop-blur">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400/95">
          Meet Copilot
        </p>
        <h1 className="mt-2 bg-gradient-to-r from-cyan-100 via-zinc-100 to-violet-200 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
          {mode === "login" ? "Entrar na sua conta" : "Criar conta / tenant"}
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          {mode === "login"
            ? "Autentique com seu e-mail corporativo para liberar captura e overlay."
            : "Registre um novo tenant — o primeiro usuário fica como OWNER."}
        </p>

        <div className="mt-5 inline-flex rounded-lg border border-zinc-700/80 bg-zinc-950/80 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-md px-3 py-1 transition ${
              mode === "login"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`rounded-md px-3 py-1 transition ${
              mode === "register"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Registrar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className={labelCls}>
            Backend HTTP base
            <input
              className={field}
              value={backendHttpBase}
              onChange={(e) => setBackendHttpBase(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <label className={labelCls}>
            E-mail
            <input
              className={field}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label className={labelCls}>
            Senha
            <input
              className={field}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          <label className={labelCls}>
            Tenant slug {mode === "login" ? "(opcional)" : "(opcional, cria se ausente)"}
            <input
              className={field}
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              autoComplete="off"
              placeholder="acme"
            />
          </label>
          {mode === "register" ? (
            <>
              <label className={labelCls}>
                Nome do tenant (se criando novo)
                <input
                  className={field}
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="Acme Inc."
                  autoComplete="organization"
                />
              </label>
              <label className={labelCls}>
                Seu nome
                <input
                  className={field}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Maria Silva"
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

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg border border-cyan-500/45 bg-cyan-600/95 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_22px_-8px_rgba(34,211,238,0.5)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? "Enviando…" : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
          Tokens ficam no OS keychain · JWT RS256
        </p>
      </main>
    </div>
  );
}
