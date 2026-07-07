"use client";

import { useRef, useState } from "react";
import type { OverlayItem } from "./use-overlay-feedback-queue";
import type { CoachSeverity } from "./coach-insight-content";
import { resolveCoachInsightContent } from "./coach-insight-content";

/** Accent color per severity — drives the tip icon and progress bar only. */
const SEVERITY: Record<CoachSeverity, { color: string }> = {
  low: { color: "#16a34a" },
  med: { color: "#2563eb" },
  high: { color: "#d97706" },
  critical: { color: "#dc2626" },
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export function CoachInsightCard({
  item,
  now,
  onDismiss,
}: {
  item: OverlayItem;
  now: number;
  onDismiss: (id: string) => void;
}) {
  const { severity } = resolveCoachInsightContent(item.payload);
  const sev = SEVERITY[severity];
  const tip = item.payload.message?.trim() || "feedback sem mensagem";

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const elapsed = Math.max(0, now - item.createdAt);
  const remainingMs = Math.max(0, item.ttlMs - elapsed);
  const lifeRatio = Math.min(1, Math.max(0, remainingMs / item.ttlMs));
  const remainingSec = Math.ceil(remainingMs / 1000);
  const fadeWindow = 0.16;
  const opacity =
    item.exiting || lifeRatio > fadeWindow
      ? 1
      : Math.max(0.4, lifeRatio / fadeWindow);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setOffset({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="pointer-events-auto w-full max-w-[348px]"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: dragging ? "none" : "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        className={`coach-bubble-wrap ${
          item.exiting ? "coach-insight-exit" : "coach-insight-enter"
        } ${dragging ? "coach-card-dragging" : "coach-card-draggable"}`}
        style={{ opacity: item.exiting ? undefined : opacity }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <article className="coach-bubble relative w-full">
          <div className="flex items-start gap-2.5 px-3.5 pt-3">
          <span
            className="coach-bubble-icon mt-[1px] shrink-0"
            style={{ color: sev.color }}
            aria-hidden
          >
            <svg viewBox="0 0 20 20" width="24" height="24" fill="none">
              <path
                d="M10 2.5a5 5 0 0 0-3 9v1.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V11.5a5 5 0 0 0-3-9Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M8 17h4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>

          <p className="coach-tip min-w-0 flex-1 text-[16px] font-medium leading-[1.45] tracking-[-0.01em] text-zinc-900">
            {tip}
          </p>

          <button
            type="button"
            data-no-drag
            className="coach-close-btn shrink-0"
            aria-label="Fechar dica"
            onClick={() => onDismiss(item.id)}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
              <path
                d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-end gap-1 px-3.5 pb-2 pt-1">
          {!item.exiting ? (
            <span
              className="text-[12px] font-medium tabular-nums text-zinc-400"
              aria-label={`Fecha em ${remainingSec} segundos`}
            >
              {remainingSec}s
            </span>
          ) : null}
        </div>

        <div className="coach-ttl-track" aria-hidden>
          <div
            className="coach-ttl-fill"
            style={{
              transform: `scaleX(${item.exiting ? 0 : lifeRatio})`,
              backgroundColor: sev.color,
            }}
          />
        </div>
        </article>
        <span className="coach-bubble-tail" aria-hidden />
      </div>
    </div>
  );
}
