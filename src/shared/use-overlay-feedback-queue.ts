"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedbackPayload } from "./feedback-client";
import { resolveSeverity, type CoachSeverity } from "./coach-insight-content";

export type OverlayItem = {
  id: string;
  payload: FeedbackPayload;
  createdAt: number;
  severity: CoachSeverity;
  /** Remaining lifetime in ms when the card was pushed. */
  ttlMs: number;
  exiting?: boolean;
};

export const OVERLAY_EXIT_ANIM_MS = 380;
const MAX_ITEMS = 4;
const TICK_MS = 200;

/** Auto-dismiss duration per severity — all cards close; higher severity gets more time. */
export const OVERLAY_TTL_MS: Record<CoachSeverity, number> = {
  low: 5500,
  med: 5500,
  high: 9000,
  critical: 12000,
};

function ttlForSeverity(severity: CoachSeverity): number {
  return OVERLAY_TTL_MS[severity];
}

type ItemTimers = { exit: number; remove: number };

export function useOverlayFeedbackQueue() {
  const [items, setItems] = useState<OverlayItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const timersRef = useRef<Map<string, ItemTimers>>(new Map());
  const seenIdsRef = useRef<Set<string>>(new Set());

  const clearItemTimers = useCallback((id: string) => {
    const timers = timersRef.current.get(id);
    if (!timers) return;
    window.clearTimeout(timers.exit);
    window.clearTimeout(timers.remove);
    timersRef.current.delete(id);
  }, []);

  const dismissFeedback = useCallback(
    (id: string) => {
      clearItemTimers(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, exiting: true } : item)),
      );
      const removeTimer = window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
        timersRef.current.delete(id);
      }, OVERLAY_EXIT_ANIM_MS);
      timersRef.current.set(id, {
        exit: removeTimer,
        remove: removeTimer,
      });
    },
    [clearItemTimers],
  );

  const scheduleAutoDismiss = useCallback(
    (id: string, ttlMs: number) => {
      clearItemTimers(id);
      const exitTimer = window.setTimeout(() => {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, exiting: true } : item)),
        );
        const removeTimer = window.setTimeout(() => {
          setItems((prev) => prev.filter((item) => item.id !== id));
          timersRef.current.delete(id);
        }, OVERLAY_EXIT_ANIM_MS);
        timersRef.current.set(id, { exit: exitTimer, remove: removeTimer });
      }, ttlMs);
      timersRef.current.set(id, {
        exit: exitTimer,
        remove: exitTimer,
      });
    },
    [clearItemTimers],
  );

  const pushFeedback = useCallback(
    (payload: FeedbackPayload) => {
      const id =
        payload.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (payload.id) {
        if (seenIdsRef.current.has(id)) return;
        seenIdsRef.current.add(id);
        if (seenIdsRef.current.size > 512) {
          const oldest = seenIdsRef.current.values().next().value;
          if (oldest) seenIdsRef.current.delete(oldest);
        }
      }
      const severity = resolveSeverity(payload);
      const ttlMs = ttlForSeverity(severity);

      setItems((prev) => {
        const next = [
          { id, payload, createdAt: Date.now(), severity, ttlMs },
          ...prev,
        ].slice(0, MAX_ITEMS);
        for (const dropped of prev.slice(MAX_ITEMS - 1)) {
          clearItemTimers(dropped.id);
        }
        return next;
      });

      scheduleAutoDismiss(id, ttlMs);
    },
    [clearItemTimers, scheduleAutoDismiss],
  );

  useEffect(() => {
    const hasTimed = items.some((item) => !item.exiting);
    if (!hasTimed) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [items]);

  useEffect(() => {
    const timers = timersRef.current;
    const seenIds = seenIdsRef.current;
    return () => {
      for (const id of timers.keys()) {
        const t = timers.get(id);
        if (t) {
          window.clearTimeout(t.exit);
          window.clearTimeout(t.remove);
        }
      }
      timers.clear();
      seenIds.clear();
    };
  }, []);

  return {
    items,
    now,
    pushFeedback,
    dismissFeedback,
    isVisible: items.length > 0,
  };
}
