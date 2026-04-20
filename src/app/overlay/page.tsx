"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DesktopFeedbackClient,
  type FeedbackPayload,
} from "@/shared/feedback-client";
import { useAuth } from "@/shared/auth-context";

type CaptureStatus = "idle" | "capturing";
type OverlayItem = {
  id: string;
  payload: FeedbackPayload;
  createdAt: number;
};

const ITEM_TTL_MS = 15000;
const MAX_ITEMS = 6;
const TICK_MS = 250;

function severityStyles(severity: FeedbackPayload["severity"]): string {
  if (severity === "critical") return "border-rose-500/35 bg-rose-950/75 text-rose-50";
  if (severity === "warning") return "border-amber-500/35 bg-amber-950/65 text-amber-50";
  return "border-cyan-500/30 bg-cyan-950/50 text-cyan-50";
}

function severityLabel(severity: FeedbackPayload["severity"]): string {
  if (severity === "critical") return "Alerta";
  if (severity === "warning") return "Atenção";
  return "Dica";
}

function parseSpinBadge(payload: FeedbackPayload): string {
  const metadata = payload.metadata || {};
  const stateRaw = metadata.conversationStateJson;
  let phase = "";
  let risk = false;
  if (typeof stateRaw === "string") {
    try {
      const parsed = JSON.parse(stateRaw) as {
        fase_spin?: string;
        alerta_risco_spin?: boolean;
      };
      phase = parsed.fase_spin || "";
      risk = parsed.alerta_risco_spin === true;
    } catch {
      /* ignore */
    }
  }

  if (metadata.spinPhase && typeof metadata.spinPhase === "string") {
    phase = metadata.spinPhase;
  }
  if (metadata.spinRisk === true) {
    risk = true;
  }
  const parts: string[] = [];
  if (risk) parts.push("Risco SPIN");
  if (phase && phase !== "neutro") parts.push(`Fase: ${phase}`);
  return parts.join(" · ");
}

function FeedbackTipCard({
  item,
  ttlMs,
  now,
  onDismiss,
}: {
  item: OverlayItem;
  ttlMs: number;
  now: number;
  onDismiss: (id: string) => void;
}) {
  const tips = Array.isArray(item.payload.tips)
    ? item.payload.tips
    : Array.isArray(item.payload.metadata?.tips)
      ? (item.payload.metadata?.tips as string[])
      : [];
  const spinBadge = parseSpinBadge(item.payload);
  const elapsed = Math.max(0, now - item.createdAt);
  const remaining = Math.max(0, ttlMs - elapsed);
  const progress = Math.min(1, remaining / ttlMs);

  return (
    <article
      className={`overlay-tip-enter relative w-full max-w-[360px] overflow-hidden rounded-2xl border px-3.5 py-3 shadow-[0_0_32px_-10px_rgba(34,211,238,0.2),0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md ${severityStyles(item.payload.severity)}`}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/5 blur-2xl"
        aria-hidden
      />
      <div className="relative flex gap-2.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900/80 text-lg"
          aria-hidden
        >
          💡
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              {severityLabel(item.payload.severity)}
            </p>
            <button
              type="button"
              aria-label="Dispensar esta dica"
              className="-mr-1 -mt-0.5 shrink-0 rounded-md border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 transition hover:bg-black/35 hover:text-zinc-100"
              onClick={() => onDismiss(item.id)}
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-[13px] font-semibold leading-snug tracking-tight text-zinc-50">
            {item.payload.message || "feedback sem mensagem"}
          </p>
          {spinBadge ? (
            <p className="mt-1.5 text-[11px] font-medium text-amber-200/95">{spinBadge}</p>
          ) : null}
          {tips.length > 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-300/95">
              {tips.join(" · ")}
            </p>
          ) : null}
          <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
            {(item.payload.type || "llm_insight").replaceAll("_", " ")}
          </p>
        </div>
      </div>
      <div className="relative mt-2.5 h-1 overflow-hidden rounded-full bg-black/25" aria-hidden>
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500/90 to-emerald-400/80 transition-[width] duration-75 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="mt-1 text-right font-mono text-[9px] text-zinc-500">
        {Math.ceil(remaining / 1000)}s
      </p>
    </article>
  );
}

export default function OverlayPage() {
  const { session } = useAuth();
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [meetingId, setMeetingId] = useState("abc-defg-hij");
  const [feedbackHttpBase, setFeedbackHttpBase] = useState("http://localhost:3001");
  const [statusLine, setStatusLine] = useState("inicializando feedback…");
  const [items, setItems] = useState<OverlayItem[]>([]);
  const [isDismissed, setIsDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!window.desktopApi) return;
    void window.desktopApi.getState().then((state) => {
      setCaptureStatus(state.captureStatus);
      setMeetingId(state.meetingId || "abc-defg-hij");
      setFeedbackHttpBase(state.feedbackHttpBase || "http://localhost:3001");
    });
    const unsubscribe = window.desktopApi.onFeedbackContextUpdated((payload) => {
      setMeetingId(payload.meetingId);
      setFeedbackHttpBase(payload.feedbackHttpBase);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const dismissOne = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setItems([]);
    setIsDismissed(true);
  }, []);

  useEffect(() => {
    if (!meetingId || !feedbackHttpBase) return;
    if (!session.isAuthenticated || !session.tenant) return;
    const client = new DesktopFeedbackClient({
      meetingId,
      tenantId: session.tenant.id,
      httpBase: feedbackHttpBase,
      getAccessToken: async () =>
        (await window.desktopApi?.getAccessToken?.()) ?? null,
      onStatus: (status) => setStatusLine(status),
      onFeedback: (payload) => {
        const id = payload.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setIsDismissed(false);
        setItems((prev) =>
          [{ id, payload, createdAt: Date.now() }, ...prev].slice(0, MAX_ITEMS),
        );
        setTimeout(() => {
          setItems((prev) => prev.filter((item) => item.id !== id));
        }, ITEM_TTL_MS);
      },
    });
    void client.start();
    return () => client.stop();
  }, [meetingId, feedbackHttpBase, session.isAuthenticated, session.tenant]);

  useEffect(() => {
    if (items.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [items.length]);

  const isVisible = items.length > 0 && !isDismissed;

  useEffect(() => {
    const api = window.desktopApi;
    if (!api?.setOverlayWindowVisible) return;
    void api.setOverlayWindowVisible(isVisible);
  }, [isVisible]);

  return (
    <div
      className={`flex h-screen w-screen items-start justify-end bg-transparent p-3 ${
        isVisible ? "" : "pointer-events-none"
      }`}
    >
      {!isVisible ? null : (
        <div
          className="pointer-events-auto flex max-h-[calc(100vh-24px)] w-[380px] flex-col items-end gap-3 overflow-y-auto overflow-x-hidden pb-1 pl-1 pt-1 [scrollbar-width:thin]"
          aria-label="Dicas do copiloto"
        >
          <p className="sr-only" aria-live="polite" aria-atomic>
            {items[0]
              ? `${severityLabel(items[0].payload.severity)}: ${items[0].payload.message || "novo feedback"}`
              : ""}
          </p>
          <div className="flex w-full shrink-0 items-center justify-end gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ${
                captureStatus === "capturing"
                  ? "border-cyan-500/40 bg-cyan-950/80 text-cyan-200"
                  : "border-zinc-600 bg-zinc-900/90 text-zinc-400"
              }`}
              title="Estado da captura"
            >
              {captureStatus}
            </span>
            <button
              type="button"
              className="rounded-md border border-zinc-600/90 bg-zinc-950/90 px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              onClick={dismissAll}
            >
              Fechar todos
            </button>
          </div>

          {items.map((item) => (
            <FeedbackTipCard
              key={item.id}
              item={item}
              ttlMs={ITEM_TTL_MS}
              now={now}
              onDismiss={dismissOne}
            />
          ))}

          <p className="w-full text-right font-mono text-[9px] leading-tight text-zinc-500/90">
            <span className="sr-only">Contexto: </span>
            {meetingId} · {statusLine}
          </p>
        </div>
      )}
    </div>
  );
}
