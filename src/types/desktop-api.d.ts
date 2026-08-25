import type { DesktopConfig } from "@/shared/desktop-config";

type DesktopState = {
  captureStatus: "idle" | "capturing";
  clickThrough: boolean;
  logs: string[];
  config: DesktopConfig;
  meetingId: string;
  feedbackHttpBase: string;
  anchorMode: "fixed" | "meet-window";
  selectedSourceId: string;
  update: {
    status:
      | "idle"
      | "checking"
      | "available"
      | "not-available"
      | "downloading"
      | "downloaded"
      | "error";
    message: string;
    version: string;
    progress: number;
  };
};

export type DisplaySource = {
  id: string;
  name: string;
  display_id?: string;
  thumbnailDataUrl?: string;
  iconDataUrl?: string;
  appIconDataUrl?: string;
  isMeet: boolean;
  isChrome: boolean;
  kind: "window" | "screen";
};

export type CaptureReadiness = {
  ok: boolean;
  platform: string;
  appName?: string;
  isPackaged?: boolean;
  macosVersion?: string;
  macosMajor?: number;
  microphoneStatus: string;
  screenStatus: string;
  displaySourceCount?: number;
  missing: Array<"macos-version" | "microphone" | "screen">;
  notes: string[];
};

export type PlaybookActionTypeValue = "copy_text" | "open_url" | "noop";

export type PlaybookStepPayload = {
  id: string;
  label: string;
  detail?: string;
  action: {
    type: PlaybookActionTypeValue;
    payload?: string;
  };
};

/** Row returned by `GET /playbooks` (dates as ISO strings over JSON). */
export type PlaybookTemplateSummary = {
  id: string;
  tenantId: string;
  key: string;
  title: string;
  description: string | null;
  steps: unknown;
  /** Original PDF filename when a source doc was uploaded (admin only). */
  sourcePdfFileName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlaybookTemplatePayload = {
  key: string;
  title: string;
  description?: string;
  steps: PlaybookStepPayload[];
};

export type UpdatePlaybookTemplatePayload = {
  title?: string;
  description?: string;
  steps?: PlaybookStepPayload[];
};

type DesktopApi = {
  getState: () => Promise<DesktopState>;
  startCapture: () => Promise<{ ok: true; captureStatus: "capturing" }>;
  stopCapture: () => Promise<{ ok: true; captureStatus: "idle" }>;
  setClickThrough: (enabled: boolean) => Promise<{ ok: true; clickThrough: boolean }>;
  setOverlayWindowVisible: (visible: boolean) => Promise<{ ok: true; visible: boolean }>;
  setOverlayContentHeight: (height: number) => Promise<{ ok: true; height: number }>;
  /** Open https URLs only; hostname must match `PLAYBOOK_URL_ALLOWLIST` (same CSV as backend). */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
  setFeedbackContext: (payload: {
    meetingId?: string;
    feedbackHttpBase?: string;
  }) => Promise<{ ok: true; meetingId: string; feedbackHttpBase: string }>;
  publishDirectFeedback: (
    payload: Record<string, unknown>,
  ) => Promise<{ ok: true }>;
  protocolPreview: (payload: {
    meetUrl?: string;
    meetingId?: string;
    participant?: string;
    track?: string;
    sampleRate?: number;
    channels?: number;
  }) => Promise<{ wsUrl: string; httpBase: string }>;
  protocolValidate: (payload: {
    meetUrl?: string;
    meetingId?: string;
    participant?: string;
    track?: string;
    sampleRate?: number;
    channels?: number;
  }) => Promise<{
    ok: boolean;
    wsUrl: string;
    handshake: boolean;
    payloadSentBytes: number;
    closedCode?: number;
    error?: string;
  }>;
  onFeedbackContextUpdated: (
    handler: (payload: { meetingId: string; feedbackHttpBase: string }) => void,
  ) => () => void;
  onDirectFeedback: (
    handler: (payload: Record<string, unknown>) => void,
  ) => () => void;
  onAnchorModeUpdated: (
    handler: (payload: { anchorMode: "fixed" | "meet-window" }) => void,
  ) => () => void;
  getPermissionPolicy: () => Promise<{
    platform: string;
    microphoneStatus: string;
    cameraStatus: string;
    isAccessibilityTrusted: boolean | null;
    notes: string[];
  }>;
  requestPermission: (
    kind: "microphone" | "screen" | "accessibility",
  ) => Promise<{ ok: boolean; kind?: string; granted?: boolean | null; error?: string }>;
  checkForUpdates: () => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;
  downloadUpdate: () => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;
  installUpdateNow: () => Promise<{ ok: boolean; skipped?: boolean; reason?: string }>;
  onUpdateStatus: (
    handler: (payload: DesktopState["update"]) => void,
  ) => () => void;
  checkCaptureReadiness: () => Promise<CaptureReadiness>;
  listDisplaySources: () => Promise<DisplaySource[]>;
  setSelectedSource: (
    sourceId: string,
  ) => Promise<{ ok: boolean; sourceId: string }>;
  reportCaptureError: (payload: {
    stage: string;
    message: string;
    detail?: string;
  }) => Promise<{ ok: true }>;
  onLogs: (handler: (payload: string[]) => void) => () => void;
  onLogEntry: (handler: (payload: { line: string; ts: number }) => void) => () => void;
  onSelectedSourceUpdated: (
    handler: (payload: { sourceId: string }) => void,
  ) => () => void;
  /** Resultado do SOS disparado pelo atalho global (Ctrl/Cmd+Shift+H). */
  onSosStatus: (
    handler: (payload: { ok: boolean; message: string }) => void,
  ) => () => void;
  authLogin: (payload: {
    email: string;
    password: string;
    tenantSlug?: string;
  }) => Promise<AuthSessionSnapshot>;
  authLogout: () => Promise<{ ok: true }>;
  authRefresh: () => Promise<AuthSessionSnapshot>;
  getAuthSession: () => Promise<AuthSessionSnapshot>;
  /**
   * Returns a short-lived access token for use by the renderer when it needs
   * to establish Socket.IO/WebSocket connections directly. Token is `null`
   * whenever the user is not authenticated.
   */
  getAccessToken: () => Promise<string | null>;
  onAuthSessionUpdated: (
    handler: (payload: AuthSessionSnapshot) => void,
  ) => () => void;
  membersList: () => Promise<MemberSummary[]>;
  membersUpdateRole: (payload: {
    membershipId: string;
    role: MembershipRoleValue;
  }) => Promise<MemberSummary>;
  membersRemove: (payload: { membershipId: string }) => Promise<{ removed: true }>;
  invitesList: () => Promise<InvitationSummary[]>;
  invitesCreate: (payload: {
    email: string;
    role?: MembershipRoleValue;
  }) => Promise<{
    id: string;
    email: string;
    role: MembershipRoleValue;
    token: string;
    expiresAt: string;
  }>;
  invitesRevoke: (payload: { invitationId: string }) => Promise<{ revoked: true }>;
  invitesAccept: (payload: { token: string }) => Promise<{
    membershipId: string;
    tenantId: string;
    tenantSlug: string;
    role: MembershipRoleValue;
  }>;
  invitesAcceptPublic: (payload: {
    token: string;
    password: string;
    name?: string;
  }) => Promise<AuthSessionSnapshot>;
  monitorLiveMeetings: () => Promise<MonitorLiveMeeting[]>;
  monitorMeeting: (payload: { meetingId: string }) => Promise<MonitorMeetingDetail>;
  monitorWhisper: (payload: {
    meetingId: string;
    message: string;
  }) => Promise<{ id: string; meetingId: string }>;
  monitorAlerts: (payload?: { since?: string }) => Promise<MonitorAlert[]>;
  monitorAckAlert: (payload: { alertId: string }) => Promise<MonitorAlert>;
  monitorSos: (payload: { meetingId: string }) => Promise<MonitorAlert>;
  billingSubscription: () => Promise<SubscriptionSnapshot>;
  billingOpenPortal: () => Promise<{ ok: boolean }>;
  playbooksList: () => Promise<PlaybookTemplateSummary[]>;
  playbooksCreate: (payload: CreatePlaybookTemplatePayload) => Promise<PlaybookTemplateSummary>;
  playbooksUpdate: (
    payload: { id: string } & UpdatePlaybookTemplatePayload,
  ) => Promise<PlaybookTemplateSummary>;
  playbooksRemove: (payload: { id: string }) => Promise<{ deleted: true } | unknown>;
  /** Upload PDF source for RAG indexing (admin path; not used during Live call). */
  playbooksUploadSourcePdf: (payload: {
    id: string;
    fileName: string;
    data: Uint8Array | number[];
  }) => Promise<PlaybookTemplateSummary>;
  playbooksRemoveSourcePdf: (payload: {
    id: string;
  }) => Promise<PlaybookTemplateSummary>;
  specialistsCatalog: () => Promise<{
    specialists: Array<{
      key: string;
      name: string;
      description: string;
      source: string;
    }>;
  }>;
  specialistsPreferencesGet: () => Promise<{ specialistKeys: string[] }>;
  specialistsPreferencesSave: (payload: {
    specialistKeys: string[];
  }) => Promise<{ specialistKeys: string[] }>;
  getAcousticCorpusDir: () => Promise<string>;
  saveAcousticCorpus: (payload: {
    manifest: Record<string, unknown>;
    micWav: Uint8Array | number[];
    loopbackWav: Uint8Array | number[];
  }) => Promise<{ sessionDir: string; sessionId: string }>;
  sellerRoomsList: () => Promise<SellerRoomSummary[]>;
  sellerRoomsGet: (payload: { id: string }) => Promise<SellerRoomSummary>;
  sellerRoomsCreate: (payload: {
    name: string;
    meetingId: string;
    meetUrl?: string;
  }) => Promise<SellerRoomSummary>;
  sellerRoomsInvite: (payload: {
    id: string;
    email: string;
  }) => Promise<unknown>;
  sellerRoomsAccept: (payload: { invitationId: string }) => Promise<SellerRoomSummary>;
  sellerRoomsJoin: (payload: { id: string }) => Promise<SellerRoomSummary>;
  sellerRoomsLeave: (payload: { id: string }) => Promise<{ ok: true }>;
  sellerRoomsEnd: (payload: { id: string }) => Promise<SellerRoomSummary>;
};

export type SellerRoomSummary = {
  id: string;
  tenantId: string;
  meetingId: string;
  name: string;
  status: "OPEN" | "ACTIVE" | "ENDED" | "ARCHIVED";
  meetUrl?: string | null;
  createdById?: string;
  createdBy?: { id: string; email: string; name: string | null };
  myMemberStatus?: "INVITED" | "JOINED" | "LEFT" | null;
  isCreator?: boolean;
  onlineUserIds?: string[];
  onlineCount?: number;
  iAmOnline?: boolean;
  pendingInvitationId?: string | null;
  members?: Array<{
    userId: string;
    status: string;
    user?: { id: string; email: string; name: string | null };
  }>;
  invitations?: Array<{
    id: string;
    inviteeId: string;
    status: string;
    invitee?: { id: string; email: string; name: string | null };
    invitedBy?: { id: string; email: string; name: string | null };
  }>;
};

export type MembershipRoleValue = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";

export type MonitorHealthBand = "green" | "yellow" | "red";

export type MonitorSnapshot = {
  meetingId: string;
  tenantId: string;
  healthScore: number;
  healthBand: MonitorHealthBand;
  healthFactors: string[];
  talkListen: {
    hostSpeechMs: number;
    customerSpeechMs: number;
    hostRatio: number;
    /** Host ratio over the last ~2min moving window. */
    hostRatioRecent: number;
    hostMonologueMs: number;
  };
  objections: { active: string[]; resolved: string[] };
  playbookAdherence: {
    percent: number;
    faseSpin: string;
    steps: Array<{ id: string; label: string; done: boolean }>;
  };
  sentiment: { current: string; trend: string };
  alerts: Array<{ kind: "red" | "yellow" | "sos"; message: string }>;
  tsMs: number;
};

export type MonitorLiveMeeting = {
  meetingId: string;
  status: string;
  startedAt: string;
  lastSeenAt: string;
  durationMs: number;
  activeConnections: number;
  rep: { id: string; name: string | null; email: string } | null;
  snapshot: MonitorSnapshot | null;
};

export type MonitorMeetingDetail = {
  session: Omit<MonitorLiveMeeting, "snapshot">;
  snapshot: MonitorSnapshot | null;
  feedbacks: Array<Record<string, unknown>>;
  alerts: MonitorAlert[];
};

export type MonitorAlert = {
  id: string;
  tenantId: string;
  meetingId: string;
  kind: "red" | "yellow" | "sos";
  message: string;
  metadata?: Record<string, unknown> | null;
  acknowledgedAt?: string | null;
  createdAt: string;
};
export type PlanValue = "FREE" | "PRO" | "ENTERPRISE";

export type AuthSessionSnapshot = {
  isAuthenticated: boolean;
  user: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  membership: {
    id: string;
    tenantId: string;
    role: MembershipRoleValue;
  } | null;
  tenant: {
    id: string;
    slug: string;
    name: string;
  } | null;
  accessExpiresAt: number | null;
  refreshExpiresAt: number | null;
  backendHttpBase: string | null;
};

export type MemberSummary = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: MembershipRoleValue;
  createdAt: string;
  lastLoginAt: string | null;
};

export type InvitationSummary = {
  id: string;
  email: string;
  role: MembershipRoleValue;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  invitedById: string;
};

export type SubscriptionSnapshot = {
  plan: PlanValue;
  status: string;
  maxUsers: number;
  memberCount: number;
  pendingInvites: number;
  seatsRemaining: number;
  entitled?: boolean;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
};

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
