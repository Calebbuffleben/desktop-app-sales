/**
 * Canonical wire shape for `metadata.playbook` on Socket.IO feedback payloads.
 * Mirror of backend/src/playbooks/playbook-metadata.contract.ts — update both together.
 */

export const PLAYBOOK_MAX_STEPS = 5;
export const PLAYBOOK_MAX_STEP_LABEL_CHARS = 120;
export const PLAYBOOK_MAX_STEP_DETAIL_CHARS = 280;
export const PLAYBOOK_MAX_ACTION_PAYLOAD_CHARS = 2000;
export const PLAYBOOK_MAX_TEMPLATE_KEY_CHARS = 64;
export const PLAYBOOK_MAX_STEP_ID_CHARS = 64;
export const PLAYBOOK_MAX_TITLE_CHARS = 160;

export type PlaybookActionType = "copy_text" | "open_url" | "noop";

export type PlaybookStepResolved = {
  id: string;
  label: string;
  detail?: string;
  action: {
    type: PlaybookActionType;
    payload: string;
  };
};

/** Nested under `FeedbackPayload.metadata.playbook`. */
export type FeedbackPlaybookMetadata = {
  templateKey?: string;
  title?: string;
  steps: PlaybookStepResolved[];
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isOptionalBoundedString(v: unknown, max: number): boolean {
  if (v === undefined) return true;
  return typeof v === "string" && v.length <= max;
}

function isPlaybookActionType(v: unknown): v is PlaybookActionType {
  return v === "copy_text" || v === "open_url" || v === "noop";
}

/**
 * Narrow unknown metadata.playbook for safe rendering in the overlay.
 * Drops invalid steps silently; caps steps at PLAYBOOK_MAX_STEPS.
 */
export function parseFeedbackPlaybookMetadata(raw: unknown): FeedbackPlaybookMetadata | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;

  const stepsRaw = o.steps;
  if (!Array.isArray(stepsRaw)) return undefined;

  const templateKey =
    isOptionalBoundedString(o.templateKey, PLAYBOOK_MAX_TEMPLATE_KEY_CHARS) &&
    typeof o.templateKey === "string"
      ? o.templateKey
      : undefined;
  const title =
    isOptionalBoundedString(o.title, PLAYBOOK_MAX_TITLE_CHARS) && typeof o.title === "string"
      ? o.title
      : undefined;

  const steps: PlaybookStepResolved[] = [];
  for (const item of stepsRaw) {
    if (steps.length >= PLAYBOOK_MAX_STEPS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    const id = isNonEmptyString(s.id) && s.id.length <= PLAYBOOK_MAX_STEP_ID_CHARS ? s.id : undefined;
    const label =
      isNonEmptyString(s.label) && s.label.length <= PLAYBOOK_MAX_STEP_LABEL_CHARS
        ? s.label
        : undefined;
    if (!id || !label) continue;

    const detail =
      s.detail === undefined
        ? undefined
        : isNonEmptyString(s.detail) && s.detail.length <= PLAYBOOK_MAX_STEP_DETAIL_CHARS
          ? s.detail
          : undefined;

    const actionRaw = s.action;
    if (!actionRaw || typeof actionRaw !== "object" || Array.isArray(actionRaw)) continue;
    const ar = actionRaw as Record<string, unknown>;
    const type = ar.type;
    const payload = ar.payload;
    if (!isPlaybookActionType(type)) continue;
    if (!isNonEmptyString(payload) || payload.length > PLAYBOOK_MAX_ACTION_PAYLOAD_CHARS) continue;

    steps.push({
      id,
      label,
      ...(detail !== undefined ? { detail } : {}),
      action: { type, payload },
    });
  }

  if (steps.length === 0) return undefined;
  return {
    ...(templateKey !== undefined ? { templateKey } : {}),
    ...(title !== undefined ? { title } : {}),
    steps,
  };
}
