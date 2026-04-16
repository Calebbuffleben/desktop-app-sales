"use client";

import { useEffect, useState } from "react";
import {
  DesktopFeedbackClient,
  type FeedbackPayload,
} from "@/shared/feedback-client";

type CaptureStatus = "idle" | "capturing";
type OverlayItem = {
  id: string;
  payload: FeedbackPayload;
};
const ITEM_TTL_MS = 15000;
const MAX_ITEMS = 6;

function severityStyles(severity: FeedbackPayload["severity"]): string {
  if (severity === "critical") return "border-rose-500/35 bg-rose-950/75 text-rose-50";
  if (severity === "warning") return "border-amber-500/35 bg-amber-950/65 text-amber-50";
  return "border-cyan-500/30 bg-cyan-950/50 text-cyan-50";
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
    } catch {}
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

export default function OverlayPage() {
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [meetingId, setMeetingId] = useState("abc-defg-hij");
  const [feedbackHttpBase, setFeedbackHttpBase] = useState("http://localhost:3001");
  const [statusLine, setStatusLine] = useState("inicializando feedback…");
  const [items, setItems] = useState<OverlayItem[]>([]);
  const [isDismissed, setIsDismissed] = useState(false);

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

  useEffect(() => {
    if (!meetingId || !feedbackHttpBase) return;
    const client = new DesktopFeedbackClient({
      meetingId,
      httpBase: feedbackHttpBase,
      onStatus: (status) => setStatusLine(status),
      onFeedback: (payload) => {
        const id = payload.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setIsDismissed(false);
        setItems((prev) => [{ id, payload }, ...prev].slice(0, MAX_ITEMS));
        setTimeout(() => {
          setItems((prev) => prev.filter((item) => item.id !== id));
        }, ITEM_TTL_MS);
      },
    });
    client.start();
    return () => client.stop();
  }, [meetingId, feedbackHttpBase]);

  const isVisible = items.length > 0 && !isDismissed;

  return (
    <div
      className={`flex h-screen w-screen items-start justify-end bg-transparent p-3 ${
        isVisible ? "" : "pointer-events-none"
      }`}
    >
      {!isVisible ? null : (
      <div className="relative w-[400px] overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#05080f]/94 px-4 py-3 text-zinc-100 shadow-[0_0_40px_-8px_rgba(34,211,238,0.25),0_24px_48px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative mb-3 flex items-start justify-between gap-2 border-b border-cyan-500/15 pb-2">
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-cyan-400/95">
              Copiloto de vendas
            </p>
            <p className="mt-1 text-[13px] font-semibold tracking-tight text-zinc-50">Insights ao vivo</p>
          </div>
          <div className="flex items-start gap-2">
            <span
              className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] ${
                captureStatus === "capturing"
                  ? "border-cyan-500/40 bg-cyan-950/80 text-cyan-200"
                  : "border-zinc-600 bg-zinc-900/90 text-zinc-400"
              }`}
            >
              {captureStatus}
            </span>
            <button
              type="button"
              aria-label="Fechar widget de feedback"
              className="rounded-md border border-zinc-700 bg-zinc-950/90 px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              onClick={() => {
                setItems([]);
                setIsDismissed(true);
              }}
            >
              Fechar
            </button>
          </div>
        </div>
        <p className="text-[11px] font-medium text-zinc-500">
          meetingId: <span className="font-mono text-zinc-300">{meetingId}</span>
        </p>
        <p className="mb-3 font-mono text-[10px] text-zinc-500">{statusLine}</p>

        <div className="space-y-2">
          {items.map((item) => {
            const tips = Array.isArray(item.payload.tips)
              ? item.payload.tips
              : Array.isArray(item.payload.metadata?.tips)
                ? (item.payload.metadata?.tips as string[])
                : [];
            const spinBadge = parseSpinBadge(item.payload);
            return (
              <div
                key={item.id}
                className={`rounded-lg border px-3 py-2.5 text-xs shadow-[0_0_0_1px_rgba(34,211,238,0.04)] ${severityStyles(item.payload.severity)}`}
              >
                <p className="text-[12px] font-semibold leading-snug text-zinc-50">
                  {item.payload.message || "feedback sem mensagem"}
                </p>
                {spinBadge ? <p className="mt-1.5 text-[11px] font-medium text-amber-200/95">{spinBadge}</p> : null}
                {tips.length > 0 ? (
                  <p className="mt-1 text-[11px] text-zinc-300">Dicas: {tips.join(" · ")}</p>
                ) : null}
                <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                  {(item.payload.type || "llm_insight").replaceAll("_", " ")}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
