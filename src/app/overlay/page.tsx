"use client";

import { useEffect, useState } from "react";
import {
  DesktopFeedbackClient,
  normalizeFeedbackPayload,
} from "@/shared/feedback-client";
import { DirectFeedbackClient } from "@/shared/direct-feedback-client";
import type { DesktopConfig } from "@/shared/desktop-config";
import { CoachInsightCard } from "@/shared/coach-insight-card";
import { useDevFeedbackInject } from "@/shared/use-dev-feedback-inject";
import { useOverlayFeedbackQueue } from "@/shared/use-overlay-feedback-queue";
import { useAuth } from "@/shared/auth-context";

export default function OverlayPage() {
  const { session } = useAuth();
  const { items, now, pushFeedback, dismissFeedback, isVisible } = useOverlayFeedbackQueue();
  const [meetingId, setMeetingId] = useState("abc-defg-hij");
  const [feedbackHttpBase, setFeedbackHttpBase] = useState(
    "https://backend-analysis-production-a688.up.railway.app",
  );
  const [desktopConfig, setDesktopConfig] = useState<DesktopConfig | null>(null);

  useEffect(() => {
    if (!window.desktopApi) return;
    void window.desktopApi.getState().then((state) => {
      setMeetingId(state.meetingId || "abc-defg-hij");
      setDesktopConfig(state.config ?? null);
      setFeedbackHttpBase(
        state.feedbackHttpBase ||
          "https://backend-analysis-production-a688.up.railway.app",
      );
    });
    const unsubscribe = window.desktopApi.onFeedbackContextUpdated((payload) => {
      setMeetingId(payload.meetingId);
      setFeedbackHttpBase(payload.feedbackHttpBase);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useDevFeedbackInject(pushFeedback);

  useEffect(() => {
    const api = window.desktopApi;
    if (!api?.onDirectFeedback) return;
    return api.onDirectFeedback((payload) => {
      pushFeedback(normalizeFeedbackPayload(payload));
    });
  }, [pushFeedback]);

  const effectiveFeedbackBase =
    session.backendHttpBase || feedbackHttpBase || "http://localhost:3001";

  const directEnabled = Boolean(
    desktopConfig?.PYTHON_DIRECT_ENABLED && desktopConfig?.PYTHON_WS_BASE,
  );

  useEffect(() => {
    if (!meetingId || !effectiveFeedbackBase) return;
    if (!session.isAuthenticated || !session.tenant) return;

    // Bypass do backend: feedback direto do python-service via WS.
    // O backend continua recebendo via gRPC apenas para persistência/dashboard.
    if (directEnabled && desktopConfig) {
      const direct = new DirectFeedbackClient({
        meetingId,
        tenantId: session.tenant.id,
        pythonWsBase: desktopConfig.PYTHON_WS_BASE,
        pythonWsPath: desktopConfig.PYTHON_WS_PATH,
        getAccessToken: async () =>
          (await window.desktopApi?.getAccessToken?.()) ?? null,
        onFeedback: (payload) => {
          pushFeedback(payload);
        },
      });
      void direct.start();
      return () => direct.stop();
    }

    const client = new DesktopFeedbackClient({
      meetingId,
      tenantId: session.tenant.id,
      httpBase: effectiveFeedbackBase,
      getAccessToken: async () =>
        (await window.desktopApi?.getAccessToken?.()) ?? null,
      onFeedback: (payload) => {
        pushFeedback(payload);
      },
    });
    void client.start();
    return () => client.stop();
  }, [
    meetingId,
    effectiveFeedbackBase,
    directEnabled,
    desktopConfig,
    session.isAuthenticated,
    session.tenant,
    session.backendHttpBase,
    pushFeedback,
  ]);

  useEffect(() => {
    const api = window.desktopApi;
    if (!api?.setOverlayWindowVisible) return;
    void api.setOverlayWindowVisible(isVisible);
  }, [isVisible]);

  const latest = items[0];

  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic>
        {latest?.payload.message?.trim() || ""}
      </p>

      {!isVisible ? null : (
        <div className="pointer-events-none fixed inset-0 overflow-visible">
          <div
            className="absolute bottom-6 right-6 flex w-[348px] flex-col items-end gap-2.5"
            aria-label="Sinais do copiloto"
          >
            {[...items].reverse().map((item) => (
              <CoachInsightCard
                key={item.id}
                item={item}
                now={now}
                onDismiss={dismissFeedback}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
