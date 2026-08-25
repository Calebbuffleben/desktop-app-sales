"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SessionGate } from "@/shared/session-gate";
import { useAuth } from "@/shared/auth-context";
import { canAccessManagerFloor } from "@/shared/manager-access";
import { MonitorFloorClient } from "@/shared/monitor-client";
import type { MonitorLiveMeeting, MonitorSnapshot } from "@/types/desktop-api";

export default function LiveFloorPage() {
  return (
    <SessionGate>
      <LiveFloorScreen />
    </SessionGate>
  );
}

function LiveFloorScreen() {
  const { session } = useAuth();
  const allowed = canAccessManagerFloor(session.membership?.role);
  const [meetings, setMeetings] = useState<MonitorLiveMeeting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Array<{ id: string; meetingId: string; kind: string; message: string }>>([]);

  async function ackAlert(alertId: string) {
    if (!window.desktopApi?.monitorAckAlert) return;
    try {
      await window.desktopApi.monitorAckAlert({ alertId });
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const applySnapshot = useCallback((snapshot: MonitorSnapshot) => {
    setMeetings((prev) =>
      prev.map((m) =>
        m.meetingId === snapshot.meetingId ? { ...m, snapshot } : m,
      ),
    );
  }, []);

  const refresh = useCallback(async () => {
    const api = window.desktopApi;
    if (!api?.monitorLiveMeetings) return;
    try {
      setMeetings(await api.monitorLiveMeetings());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
    const api = window.desktopApi;
    const tenantId = session.tenant?.id;
    const httpBase = session.backendHttpBase;
    if (!api || !tenantId || !httpBase) return;
    const client = new MonitorFloorClient({
      tenantId,
      httpBase,
      getAccessToken: () => api.getAccessToken(),
      onSnapshot: applySnapshot,
      onAlert: (alert) => {
        setAlerts((prev) => [alert, ...prev].slice(0, 8));
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(alert.kind === "sos" ? "SOS do vendedor" : "Alerta de call", {
            body: `${alert.meetingId}: ${alert.message}`,
            silent: alert.kind !== "red" && alert.kind !== "sos",
          });
        }
      },
      onMeetingEnded: (meetingId) => {
        setMeetings((prev) => prev.filter((m) => m.meetingId !== meetingId));
      },
    });
    void client.start();
    void Notification.requestPermission?.();
    const poll = window.setInterval(() => void refresh(), 15000);
    return () => {
      client.stop();
      window.clearInterval(poll);
    };
  }, [allowed, applySnapshot, refresh, session.backendHttpBase, session.tenant?.id]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-200">
        <p className="font-mono text-sm">Acesso restrito a OWNER, ADMIN e GESTOR.</p>
        <Link href="/" className="mt-4 inline-block text-cyan-300">← Voltar</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-400">
              Live Floor
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Chamadas ativas</h1>
            <p className="mt-1 text-xs text-zinc-400">
              {session.tenant?.name} · {meetings.length} ao vivo
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-zinc-700 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300"
          >
            ← Voltar
          </Link>
        </header>

        {error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            {error}
          </div>
        ) : null}

        {alerts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => void ackAlert(a.id)}
                title="Clique para reconhecer o alerta"
                className={`rounded-full border px-2 py-1 font-mono text-[10px] uppercase transition hover:opacity-70 ${
                  a.kind === "red" || a.kind === "sos"
                    ? "border-rose-500/50 text-rose-200"
                    : "border-amber-500/50 text-amber-200"
                }`}
              >
                {a.kind} · {a.meetingId} · {a.message} ✕
              </button>
            ))}
          </div>
        ) : null}

        {meetings.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 px-4 py-10 text-center font-mono text-[11px] text-zinc-500">
            Nenhuma call ativa no momento.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {meetings.map((m) => (
              <CallCard
                key={m.meetingId}
                meeting={m}
                urgent={alerts.some(
                  (a) =>
                    a.meetingId === m.meetingId &&
                    (a.kind === "sos" || a.kind === "red"),
                )}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function CallCard({
  meeting,
  urgent,
}: {
  meeting: MonitorLiveMeeting;
  urgent: boolean;
}) {
  const snap = meeting.snapshot;
  const band = snap?.healthBand ?? "yellow";
  const bandClass =
    band === "green"
      ? "border-emerald-500/50 bg-emerald-500/10"
      : band === "red"
        ? "border-rose-500/50 bg-rose-500/10"
        : "border-amber-500/50 bg-amber-500/10";
  const urgentClass = urgent
    ? "animate-pulse ring-2 ring-rose-500/80 ring-offset-2 ring-offset-zinc-950"
    : "";
  const ratio = Math.round((snap?.talkListen.hostRatio ?? 0) * 100);
  const duration = formatDuration(meeting.durationMs);
  const objections = snap?.objections.active ?? [];

  return (
    <Link
      href={`/war-room?meetingId=${encodeURIComponent(meeting.meetingId)}`}
      className={`rounded-xl border p-4 transition hover:border-cyan-500/50 ${bandClass} ${urgentClass}`}
    >
      {urgent ? (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-rose-300">
          ⚠ precisa de atenção
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {meeting.rep?.name || meeting.rep?.email || "Vendedor"}
          </p>
          <p className="font-mono text-[11px] text-zinc-400">{meeting.meetingId}</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider">{band}</span>
      </div>
      <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-zinc-300">
        <span>{duration}</span>
        <span>SPIN {snap?.playbookAdherence.faseSpin ?? "—"}</span>
        <span>Health {snap?.healthScore ?? "—"}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full ${ratio >= 70 ? "bg-amber-400" : "bg-cyan-400"}`}
          style={{ width: `${Math.min(100, ratio)}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[10px] text-zinc-500">
        Fala do vendedor {ratio}%
      </p>
      {objections.length > 0 ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-rose-200">
          Objeções: {objections.join(", ")}
        </p>
      ) : (
        <p className="mt-2 font-mono text-[10px] text-zinc-500">Sem objeções ativas</p>
      )}
      {snap?.healthFactors?.length ? (
        <p className="mt-1 font-mono text-[10px] text-zinc-400">
          {snap.healthFactors.slice(0, 2).join(" · ")}
        </p>
      ) : null}
    </Link>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
