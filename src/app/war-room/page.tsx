"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SessionGate } from "@/shared/session-gate";
import { useAuth } from "@/shared/auth-context";
import { canAccessManagerFloor } from "@/shared/manager-access";
import { DesktopFeedbackClient, normalizeFeedbackPayload } from "@/shared/feedback-client";
import type { FeedbackPayload } from "@/shared/feedback-client";
import type { MonitorAlert, MonitorMeetingDetail, MonitorSnapshot } from "@/types/desktop-api";
import { MonitorFloorClient } from "@/shared/monitor-client";

export default function WarRoomPage() {
  return (
    <SessionGate>
      <WarRoomScreen />
    </SessionGate>
  );
}

function WarRoomScreen() {
  const { session } = useAuth();
  const allowed = canAccessManagerFloor(session.membership?.role);
  const meetingId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("meetingId") || "";
  }, []);
  const [detail, setDetail] = useState<MonitorMeetingDetail | null>(null);
  const [alerts, setAlerts] = useState<MonitorAlert[]>([]);
  const [insights, setInsights] = useState<FeedbackPayload[]>([]);
  const [whisper, setWhisper] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [timeline, setTimeline] = useState<Array<{ ts: number; score: number; sentiment: string }>>([]);

  const load = useCallback(async () => {
    if (!meetingId || !window.desktopApi?.monitorMeeting) return;
    try {
      const next = await window.desktopApi.monitorMeeting({ meetingId });
      setDetail(next);
      setAlerts(next.alerts ?? []);
      if (next.snapshot) {
        setTimeline((prev) =>
          [...prev, {
            ts: next.snapshot!.tsMs,
            score: next.snapshot!.healthScore,
            sentiment: next.snapshot!.sentiment.current,
          }].slice(-40),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [meetingId]);

  useEffect(() => {
    if (!allowed || !meetingId) return;
    void load();
    const api = window.desktopApi;
    const httpBase = session.backendHttpBase;
    const tenantId = session.tenant?.id;
    if (!api || !httpBase || !tenantId) return;

    const feedback = new DesktopFeedbackClient({
      meetingId,
      tenantId,
      httpBase,
      getAccessToken: () => api.getAccessToken(),
      onFeedback: (payload) => {
        setInsights((prev) => [payload, ...prev].slice(0, 80));
      },
    });
    void feedback.start();

    const floor = new MonitorFloorClient({
      tenantId,
      httpBase,
      getAccessToken: () => api.getAccessToken(),
      onSnapshot: (snapshot) => {
        if (snapshot.meetingId !== meetingId) return;
        setDetail((prev) => (prev ? { ...prev, snapshot } : prev));
        setTimeline((prev) =>
          [...prev, {
            ts: snapshot.tsMs,
            score: snapshot.healthScore,
            sentiment: snapshot.sentiment.current,
          }].slice(-40),
        );
      },
      onAlert: (alert) => {
        if (alert.meetingId !== meetingId) return;
        setAlerts((prev) =>
          prev.some((a) => a.id === alert.id)
            ? prev
            : [
                {
                  id: alert.id,
                  tenantId,
                  meetingId: alert.meetingId,
                  kind: alert.kind,
                  message: alert.message,
                  acknowledgedAt: null,
                  createdAt: alert.createdAt,
                },
                ...prev,
              ].slice(0, 30),
        );
      },
    });
    void floor.start();

    return () => {
      feedback.stop();
      floor.stop();
    };
  }, [allowed, load, meetingId, session.backendHttpBase, session.tenant?.id]);

  async function ackAlert(alertId: string) {
    if (!window.desktopApi?.monitorAckAlert) return;
    try {
      const updated = await window.desktopApi.monitorAckAlert({ alertId });
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId
            ? { ...a, acknowledgedAt: updated.acknowledgedAt ?? new Date().toISOString() }
            : a,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendWhisper(event: React.FormEvent) {
    event.preventDefault();
    if (!whisper.trim() || !window.desktopApi?.monitorWhisper) return;
    setSending(true);
    try {
      await window.desktopApi.monitorWhisper({ meetingId, message: whisper.trim() });
      setWhisper("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-200">
        <p className="font-mono text-sm">Acesso restrito a OWNER, ADMIN e GESTOR.</p>
      </div>
    );
  }

  const snap: MonitorSnapshot | null = detail?.snapshot ?? null;
  const replay = (detail?.feedbacks ?? []).map((row) =>
    normalizeFeedbackPayload(row as Record<string, unknown>),
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="border-r border-zinc-800 p-4">
          <Link href="/live-floor" className="font-mono text-[10px] uppercase text-cyan-300">
            ← Live Floor
          </Link>
          <h1 className="mt-3 text-lg font-semibold">{meetingId || "Sala de Guerra"}</h1>
          <p className="mt-1 font-mono text-[11px] text-zinc-400">
            {detail?.session.rep?.name || detail?.session.rep?.email || "—"}
          </p>
          <div className="mt-4 space-y-3">
            <Meter label="Health" value={`${snap?.healthScore ?? "—"}`} />
            <Meter label="Sentimento" value={`${snap?.sentiment.current ?? "—"} (${snap?.sentiment.trend ?? "—"})`} />
            <Meter
              label="Fala do vendedor"
              value={
                snap
                  ? `${Math.round(snap.talkListen.hostRatio * 100)}% total · ${Math.round((snap.talkListen.hostRatioRecent ?? 0) * 100)}% últimos 2min`
                  : "—"
              }
            />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Objeções
              </p>
              {snap && (snap.objections.active.length || snap.objections.resolved.length) ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {snap.objections.active.map((cat) => (
                    <span
                      key={`a-${cat}`}
                      className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-rose-200"
                    >
                      {cat}
                    </span>
                  ))}
                  {snap.objections.resolved.map((cat) => (
                    <span
                      key={`r-${cat}`}
                      className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-emerald-200"
                    >
                      {cat} ✓
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Nenhuma</p>
              )}
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Playbook</p>
              <p className="text-sm">{snap?.playbookAdherence.percent ?? 0}%</p>
              <ul className="mt-2 space-y-1">
                {(snap?.playbookAdherence.steps ?? []).map((step) => (
                  <li key={step.id} className="font-mono text-[11px] text-zinc-300">
                    {step.done ? "☑" : "☐"} {step.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Alertas</p>
              {alerts.length === 0 ? (
                <p className="text-sm text-zinc-500">Nenhum alerta</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {alerts.slice(0, 10).map((alert) => (
                    <li
                      key={alert.id}
                      className={`rounded-lg border px-2 py-1.5 ${
                        alert.acknowledgedAt
                          ? "border-zinc-800 text-zinc-500"
                          : alert.kind === "yellow"
                            ? "border-amber-500/50 bg-amber-500/10 text-amber-100"
                            : "border-rose-500/50 bg-rose-500/10 text-rose-100"
                      }`}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-wider">
                        {alert.kind}
                      </p>
                      <p className="text-xs">{alert.message}</p>
                      {alert.acknowledgedAt ? (
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-500">reconhecido</p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void ackAlert(alert.id)}
                          className="mt-1 rounded border border-current px-1.5 py-0.5 font-mono text-[10px] uppercase"
                        >
                          Reconhecer
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Timeline</p>
              <div className="mt-2 flex h-12 items-end gap-0.5">
                {timeline.map((point, i) => (
                  <span
                    key={`${point.ts}-${i}`}
                    className="w-1.5 rounded-sm bg-cyan-400/80"
                    style={{ height: `${Math.max(8, point.score * 0.48)}%` }}
                    title={`${point.score} · ${point.sentiment}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {error ? (
              <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200">
                {error}
              </div>
            ) : null}
            {(insights.length ? insights : replay).map((item, idx) => {
              const evidence =
                (typeof item.metadata?.evidence_text === "string" &&
                  item.metadata.evidence_text) ||
                (typeof item.metadata?.transcript === "string" &&
                  item.metadata.transcript) ||
                "";
              return (
              <article
                key={item.id || idx}
                className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
              >
                <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {item.type} · {item.severity}
                </p>
                <p className="mt-1 text-sm">{item.message}</p>
                {evidence ? (
                  <p className="mt-1 text-xs italic text-zinc-400">
                    “{evidence}”
                  </p>
                ) : null}
              </article>
              );
            })}
          </div>
          <form
            onSubmit={sendWhisper}
            className="flex flex-wrap items-center gap-2 border-t border-zinc-800 p-4"
          >
            <input
              value={whisper}
              onChange={(e) => setWhisper(e.target.value)}
              placeholder="Whisper text para o vendedor…"
              className="min-w-[240px] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={sending || !whisper.trim()}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Enviar whisper
            </button>
            <button
              type="button"
              disabled
              title="Fase futura"
              className="rounded-lg border border-zinc-700 px-3 py-2 font-mono text-[10px] uppercase text-zinc-500"
            >
              Audio Whisper
            </button>
            <button
              type="button"
              disabled
              title="Fase futura"
              className="rounded-lg border border-zinc-700 px-3 py-2 font-mono text-[10px] uppercase text-zinc-500"
            >
              Entrar na reunião
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-100">{value}</p>
    </div>
  );
}
