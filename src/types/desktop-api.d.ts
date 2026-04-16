import type { DesktopConfig } from "@/shared/desktop-config";

type DesktopState = {
  captureStatus: "idle" | "capturing";
  clickThrough: boolean;
  logs: string[];
  config: DesktopConfig;
  meetingId: string;
  feedbackHttpBase: string;
  anchorMode: "fixed" | "meet-window";
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

type DesktopApi = {
  getState: () => Promise<DesktopState>;
  startCapture: () => Promise<{ ok: true; captureStatus: "capturing" }>;
  stopCapture: () => Promise<{ ok: true; captureStatus: "idle" }>;
  setClickThrough: (enabled: boolean) => Promise<{ ok: true; clickThrough: boolean }>;
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
};

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};

