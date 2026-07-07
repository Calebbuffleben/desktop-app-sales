"use client";

import { useEffect } from "react";
import type { FeedbackPayload } from "./feedback-client";
import { normalizeInjectedFeedback } from "./normalize-injected-feedback";

/** Dev-only: receives synthetic feedback via local SSE injector (port 39201). */
export function useDevFeedbackInject(onFeedback: (payload: FeedbackPayload) => void) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const injectPort = process.env.NEXT_PUBLIC_FEEDBACK_INJECT_PORT || "39201";
    const streamUrl = `http://127.0.0.1:${injectPort}/stream`;
    let es: EventSource | null = null;
    let retryTimer: number | undefined;

    const connect = () => {
      es = new EventSource(streamUrl);
      es.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data) as Record<string, unknown>;
          onFeedback(normalizeInjectedFeedback(raw));
        } catch {
          /* ignore malformed dev payloads */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        retryTimer = window.setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      es?.close();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [onFeedback]);
}
