import type { DesktopConfig } from "./desktop-config.js";

export type EgressAudioParams = {
  baseWs: string;
  egressPath: string;
  meetUrl?: string;
  meetingId?: string;
  participant?: string;
  track?: string;
  sampleRate?: number;
  channels?: number;
  /** Optional JWT access token, appended as `?token=` on the URL. The backend
   * WS upgrade handler validates the token and captures the tenant context
   * as a closure for the connection lifetime. */
  token?: string;
  /** Optional tenant id for redundant validation — backend will `PERMISSION_DENIED`
   * on mismatch against the token's `tid` claim. */
  tenantId?: string;
};

function sanitize(value: string): string {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .slice(0, 128);
}

export function extractMeetRoomCode(meetUrl?: string): string {
  if (!meetUrl) return "room";
  try {
    const url = new URL(meetUrl);
    const parts = (url.pathname || "").split("/").filter(Boolean);
    if (parts.length === 0) return "room";
    if (parts[0] === "lookup" && parts[1]) return sanitize(parts[1]) || "room";
    return sanitize(parts[0]) || "room";
  } catch {
    return "room";
  }
}

export function normalizeWsBase(baseWs: string, pageUrl?: string): string {
  let normalized = String(baseWs || "").trim();
  const isSecurePage = /^https:\/\//i.test(String(pageUrl || ""));
  if (!normalized) return "ws://localhost:3001";

  const withoutScheme = normalized.replace(/^wss?:\/\//i, "");
  const isLocalhost =
    /^localhost|^127\.0\.0\.1|^\[::1\]|^0\.0\.0\.0/i.test(withoutScheme);

  if (!/^[a-z]+:\/\//i.test(normalized)) {
    normalized = (isLocalhost ? "ws://" : isSecurePage ? "wss://" : "ws://") + normalized;
  }
  if (isSecurePage && /^ws:\/\//i.test(normalized) && !isLocalhost) {
    normalized = normalized.replace(/^ws:\/\//i, "wss://");
  }
  if (isLocalhost && /^wss:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^wss:\/\//i, "ws://");
  }
  return normalized;
}

export function wsToHttpBase(wsBase: string): string {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(wsBase) ? wsBase : `ws://${wsBase}`);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "http://localhost:3001";
  }
}

export function buildEgressAudioWsUrl(params: EgressAudioParams): string {
  const pageUrl = params.meetUrl ?? "https://meet.google.com/";
  const wsBase = normalizeWsBase(params.baseWs, pageUrl);
  const fallback = new URL("ws://localhost:3001");
  const url = (() => {
    try {
      return new URL(wsBase);
    } catch {
      return fallback;
    }
  })();

  const room = params.meetingId ? sanitize(params.meetingId) : extractMeetRoomCode(pageUrl);
  const meetingId = sanitize(params.meetingId || room || "room") || "room";
  const participant = sanitize(params.participant || "browser") || "browser";
  const track = sanitize(params.track || "tab-audio") || "tab-audio";
  const sampleRate = Number.isFinite(params.sampleRate) ? Number(params.sampleRate) : 16000;
  const channels = Number.isFinite(params.channels) ? Number(params.channels) : 1;

  url.pathname = params.egressPath || "/egress-audio";
  url.searchParams.set("room", room || "room");
  url.searchParams.set("meetingId", meetingId);
  url.searchParams.set("participant", participant);
  url.searchParams.set("track", track);
  url.searchParams.set("sampleRate", String(sampleRate > 0 ? sampleRate : 16000));
  url.searchParams.set("channels", String(channels > 0 ? channels : 1));
  if (params.token) {
    url.searchParams.set("token", params.token);
  }
  if (params.tenantId) {
    url.searchParams.set("tenantId", sanitize(params.tenantId));
  }
  return url.toString();
}

export function getEgressDefaults(cfg: DesktopConfig) {
  return {
    baseWs: cfg.BACKEND_WS_BASE,
    egressPath: cfg.EGRESS_AUDIO_PATH,
    sampleRate: cfg.DEFAULT_SAMPLE_RATE,
    channels: cfg.DEFAULT_CHANNELS,
    participant: "browser",
    track: "tab-audio",
  };
}

export function buildPcm16SilentFrame(
  sampleRate: number,
  channels: number,
  frameMs = 20,
): Uint8Array {
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 16000;
  const safeChannels = Number.isFinite(channels) && channels > 0 ? channels : 1;
  const samplesPerChannel = Math.max(1, Math.round((safeSampleRate * frameMs) / 1000));
  const totalSamples = samplesPerChannel * safeChannels;
  return new Uint8Array(totalSamples * 2);
}

