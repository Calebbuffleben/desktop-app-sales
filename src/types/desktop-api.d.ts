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
  macosVersion?: string;
  macosMajor?: number;
  microphoneStatus: string;
  screenStatus: string;
  missing: Array<"macos-version" | "microphone" | "screen">;
  notes: string[];
};

type DesktopApi = {
  getState: () => Promise<DesktopState>;
  startCapture: () => Promise<{ ok: true; captureStatus: "capturing" }>;
  stopCapture: () => Promise<{ ok: true; captureStatus: "idle" }>;
  setClickThrough: (enabled: boolean) => Promise<{ ok: true; clickThrough: boolean }>;
  setOverlayWindowVisible: (visible: boolean) => Promise<{ ok: true; visible: boolean }>;
  setFeedbackContext: (payload: {
    meetingId?: string;
    feedbackHttpBase?: string;
  }) => Promise<{ ok: true; meetingId: string; feedbackHttpBase: string }>;
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
  authLogin: (payload: {
    email: string;
    password: string;
    tenantSlug?: string;
    backendHttpBase: string;
  }) => Promise<AuthSessionSnapshot>;
  authRegister: (payload: {
    email: string;
    password: string;
    tenantSlug?: string;
    tenantName?: string;
    name?: string;
    backendHttpBase: string;
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
    backendHttpBase: string;
  }) => Promise<AuthSessionSnapshot>;
  billingSubscription: () => Promise<SubscriptionSnapshot>;
  billingUpgrade: (payload: {
    plan: PlanValue;
  }) => Promise<SubscriptionSnapshot>;
};

export type MembershipRoleValue = "OWNER" | "ADMIN" | "MEMBER";
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
};

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
