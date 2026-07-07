"use client";

import { useEffect, useState } from "react";
import { DesktopFeedbackClient } from "@/shared/feedback-client";
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

  useEffect(() => {
    if (!window.desktopApi) return;
    void window.desktopApi.getState().then((state) => {
      setMeetingId(state.meetingId || "abc-defg-hij");
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

  const effectiveFeedbackBase =
    session.backendHttpBase || feedbackHttpBase || "http://localhost:3001";

  useEffect(() => {
    if (!meetingId || !effectiveFeedbackBase) return;
    if (!session.isAuthenticated || !session.tenant) return;
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
