import type { FeedbackPayload } from "./feedback-client";

const SPIN_INSIGHT_TYPE: Record<string, string> = {
  situacao: "Leitura de contexto",
  problema: "Dor identificada",
  implicacao: "Risco de perda de controle",
  necessidade: "Mudança de intenção",
  pay_off: "Sinal de engajamento",
  "pay-off": "Sinal de engajamento",
};

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  objection_timing: "Janela de oportunidade",
  engagement_signal: "Sinal de engajamento",
  intent_shift: "Mudança de intenção",
  control_risk: "Risco de perda de controle",
  opportunity_window: "Janela de oportunidade",
};

export type CoachSeverity = "low" | "med" | "high" | "critical";

export type CoachInsightContent = {
  source: { name: string; status: string };
  /** (A) Signal header — the intercepted insight, max attention. */
  signalHeader: string;
  /** (B) Context line — why the signal fired, semantic support. */
  contextLine: string | null;
  /** (C) Recommended action — single strategic move, imperative. */
  recommendedAction: string | null;
  /** (D) Signal footer — near-invisible metadata layer. */
  footer: string | null;
  severity: CoachSeverity;
};

function parseSpinPhase(payload: FeedbackPayload): string {
  const metadata = payload.metadata || {};
  if (typeof metadata.spinPhase === "string" && metadata.spinPhase) {
    return metadata.spinPhase;
  }
  const stateRaw = metadata.conversationStateJson;
  if (typeof stateRaw === "string") {
    try {
      const parsed = JSON.parse(stateRaw) as { fase_spin?: string };
      if (parsed.fase_spin) return parsed.fase_spin;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function humanizeToken(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveSource(metadata: Record<string, unknown>): { name: string; status: string } {
  const name =
    (typeof metadata.coachSource === "string" && metadata.coachSource) ||
    (typeof metadata.insightSource === "string" && metadata.insightSource) ||
    (typeof metadata.source === "string" && metadata.source) ||
    "AI Sales Coach";

  const status =
    (typeof metadata.coachStatus === "string" && metadata.coachStatus) ||
    (typeof metadata.insightStatus === "string" && metadata.insightStatus) ||
    "Live analysis";

  return { name, status };
}

function resolveInsightType(
  metadata: Record<string, unknown>,
  spinPhase: string,
  feedbackType: string,
  payloadType: string | undefined,
): string {
  if (typeof metadata.insightType === "string" && metadata.insightType.trim()) {
    return metadata.insightType.trim();
  }

  if (spinPhase && spinPhase !== "neutro") {
    return SPIN_INSIGHT_TYPE[spinPhase.toLowerCase()] || humanizeToken(spinPhase);
  }

  const normalizedFeedbackType = feedbackType.toLowerCase();
  if (FEEDBACK_TYPE_LABELS[normalizedFeedbackType]) {
    return FEEDBACK_TYPE_LABELS[normalizedFeedbackType];
  }

  if (feedbackType) return humanizeToken(feedbackType);

  if (payloadType && payloadType !== "llm_insight") {
    return humanizeToken(payloadType);
  }

  return "Sinal estratégico";
}

const SEVERITY_BY_FEEDBACK_TYPE: Record<string, CoachSeverity> = {
  control_risk: "high",
  opportunity_window: "high",
  objection_timing: "high",
  intent_shift: "med",
  engagement_signal: "low",
};

const SEVERITY_BY_SPIN: Record<string, CoachSeverity> = {
  implicacao: "high",
  necessidade: "med",
  problema: "med",
  pay_off: "low",
  "pay-off": "low",
  situacao: "low",
};

function normalizeSeverity(raw: string): CoachSeverity | null {
  const value = raw.toLowerCase().trim();
  if (value === "low" || value === "baixa" || value === "info") return "low";
  if (value === "med" || value === "medium" || value === "media" || value === "média")
    return "med";
  if (value === "high" || value === "alta" || value === "warning") return "high";
  if (value === "critical" || value === "critica" || value === "crítica") return "critical";
  return null;
}

export function resolveSeverity(payload: FeedbackPayload): CoachSeverity {
  const metadata = payload.metadata || {};

  for (const key of ["coachSeverity", "severity", "priority", "level"] as const) {
    const value = metadata[key];
    if (typeof value === "string") {
      const normalized = normalizeSeverity(value);
      if (normalized) return normalized;
    }
  }

  if (payload.severity === "critical") return "critical";
  if (payload.severity === "warning") return "high";

  const spinPhase = parseSpinPhase(payload).toLowerCase();
  if (spinPhase && SEVERITY_BY_SPIN[spinPhase]) return SEVERITY_BY_SPIN[spinPhase];

  const feedbackType = (
    typeof metadata.feedback_type === "string"
      ? metadata.feedback_type
      : typeof metadata.feedbackType === "string"
        ? metadata.feedbackType
        : ""
  ).toLowerCase();
  if (feedbackType && SEVERITY_BY_FEEDBACK_TYPE[feedbackType]) {
    return SEVERITY_BY_FEEDBACK_TYPE[feedbackType];
  }

  return "med";
}

function resolveFooter(metadata: Record<string, unknown>): string | null {
  const parts: string[] = [];

  const rawConfidence = metadata.confidence ?? metadata.score;
  const confidence =
    typeof rawConfidence === "number"
      ? rawConfidence
      : typeof rawConfidence === "string" && rawConfidence.trim() !== ""
        ? Number(rawConfidence)
        : NaN;
  if (Number.isFinite(confidence)) {
    const normalized = confidence > 1 ? confidence / 100 : confidence;
    parts.push(`Confidence ${normalized.toFixed(2)}`);
  }

  const pattern =
    (typeof metadata.pattern === "string" && metadata.pattern.trim()) ||
    (typeof metadata.signalPattern === "string" && metadata.signalPattern.trim()) ||
    "";
  if (pattern) parts.push(pattern);

  const latency =
    (typeof metadata.latency === "string" && metadata.latency.trim()) || "real-time";
  parts.push(latency);

  return parts.length > 0 ? parts.join("  ·  ") : null;
}

export function resolveCoachInsightContent(payload: FeedbackPayload): CoachInsightContent {
  const metadata = payload.metadata || {};
  const tips = Array.isArray(payload.tips)
    ? payload.tips
    : Array.isArray(metadata.tips)
      ? (metadata.tips as string[])
      : [];
  const spinPhase = parseSpinPhase(payload);
  const feedbackType =
    typeof metadata.feedback_type === "string"
      ? metadata.feedback_type
      : typeof metadata.feedbackType === "string"
        ? metadata.feedbackType
        : "";

  const source = resolveSource(metadata);
  const signalHeader = resolveInsightType(
    metadata,
    spinPhase,
    feedbackType,
    payload.type,
  );

  const contextLine = payload.message?.trim() || null;

  const playbook = payload.playbook;
  let recommendedAction: string | null = null;
  if (playbook?.steps?.[0]?.label) {
    recommendedAction = playbook.steps[0].label;
  } else if (tips.length > 0) {
    recommendedAction = tips[0];
  } else if (playbook?.title) {
    recommendedAction = playbook.title;
  }

  return {
    source,
    signalHeader,
    contextLine,
    recommendedAction,
    footer: resolveFooter(metadata),
    severity: resolveSeverity(payload),
  };
}
