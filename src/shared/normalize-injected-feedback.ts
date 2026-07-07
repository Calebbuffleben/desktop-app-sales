import type { FeedbackPayload } from "./feedback-client";
import { parseFeedbackPlaybookMetadata } from "./playbook-metadata";

export function normalizeInjectedFeedback(raw: Record<string, unknown>): FeedbackPayload {
  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};
  const tipsFromMeta = Array.isArray(metadata.tips) ? (metadata.tips as string[]) : [];
  const tipsFromRoot = Array.isArray(raw.tips) ? (raw.tips as string[]) : [];
  const playbook = parseFeedbackPlaybookMetadata(metadata.playbook);

  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    meetingId: typeof raw.meetingId === "string" ? raw.meetingId : undefined,
    participantId:
      typeof raw.participantId === "string" ? raw.participantId : undefined,
    type: typeof raw.type === "string" ? raw.type : "llm_insight",
    severity:
      raw.severity === "warning" || raw.severity === "critical"
        ? raw.severity
        : "info",
    ts:
      typeof raw.ts === "string" || typeof raw.ts === "number"
        ? raw.ts
        : Date.now(),
    message: typeof raw.message === "string" ? raw.message : "",
    tips: tipsFromRoot.length > 0 ? tipsFromRoot : tipsFromMeta,
    metadata,
    playbook,
  };
}
