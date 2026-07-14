import { io, type Socket } from "socket.io-client";

import { FingerprintBuffer } from "./fingerprint-buffer";
import {
  type AudioFingerprint,
  base64ToFeatures,
  dequantizeFeatures,
  featuresToBase64,
} from "./fingerprint-types";

export type SellerAudioFingerprintSyncOptions = {
  backendHttpBase: string;
  getAccessToken: () => Promise<string | null>;
  sellerRoomId: string;
  meetingId: string;
  tenantId: string;
  onError?: (message: string) => void;
  onJoined?: (payload: {
    members: string[];
    presence: string[];
    serverTimeMs: number;
  }) => void;
  onPresenceUpdated?: (payload: {
    onlineUserIds: string[];
    onlineCount: number;
  }) => void;
  onRoomEnded?: (reason: string) => void;
};

/** Socket.IO client for Seller Room fingerprint publish/receive. */
export class SellerAudioFingerprintSync {
  private socket: Socket | null = null;
  private readonly buffer = new FingerprintBuffer();
  private clockOffsetMs = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: SellerAudioFingerprintSyncOptions;
  private joined = false;

  constructor(opts: SellerAudioFingerprintSyncOptions) {
    this.opts = opts;
  }

  getRemoteBuffer(): FingerprintBuffer {
    return this.buffer;
  }

  getClockOffset(): number {
    return this.clockOffsetMs;
  }

  isJoined(): boolean {
    return this.joined;
  }

  async connect(): Promise<void> {
    await this.disconnect();
    const token = await this.opts.getAccessToken();
    if (!token) throw new Error("missing access token for seller-room sync");

    const base = this.opts.backendHttpBase.replace(/\/$/, "");
    this.socket = io(`${base}/seller-room`, {
      transports: ["websocket"],
      auth: { token },
      query: { token, tenantId: this.opts.tenantId },
      autoConnect: true,
      reconnection: true,
    });

    this.socket.on("connect", () => {
      void this.calibrateClock().then(() => this.joinRoom());
    });
    this.socket.on("seller-room-joined", (payload: Record<string, unknown>) => {
      this.joined = true;
      const snapshot = (payload.fingerprintSnapshot ?? {}) as Record<
        string,
        Array<Record<string, unknown>>
      >;
      for (const fps of Object.values(snapshot)) {
        for (const raw of fps) {
          const fp = wireToFingerprint(raw);
          if (fp) this.buffer.add(fp);
        }
      }
      this.opts.onJoined?.({
        members: (payload.members as string[]) ?? [],
        presence: (payload.presence as string[]) ?? [],
        serverTimeMs: Number(payload.serverTimeMs ?? Date.now()),
      });
      this.startHeartbeat();
    });
    this.socket.on("fingerprint-received", (payload: Record<string, unknown>) => {
      const fp = wireToFingerprint(
        (payload.fingerprint ?? {}) as Record<string, unknown>,
      );
      if (fp) this.buffer.add(fp);
    });
    this.socket.on("presence-updated", (payload: Record<string, unknown>) => {
      const onlineUserIds = (payload.onlineUserIds as string[]) ?? [];
      this.opts.onPresenceUpdated?.({
        onlineUserIds,
        onlineCount: Number(payload.onlineCount ?? onlineUserIds.length),
      });
    });
    this.socket.on("seller-room-ended", (payload: Record<string, unknown>) => {
      this.joined = false;
      this.buffer.clear();
      this.opts.onRoomEnded?.(String(payload.reason ?? "ended"));
    });
    this.socket.on("error", (payload: { message?: string }) => {
      this.opts.onError?.(payload.message ?? "seller-room error");
    });
    this.socket.on("connect_error", (err: Error) => {
      this.opts.onError?.(err.message);
    });
  }

  publish(fingerprint: AudioFingerprint): void {
    if (!this.socket?.connected || !this.joined) return;
    const captureServerMs =
      fingerprint.captureMonoMs + this.clockOffsetMs;
    this.socket.emit("fingerprint-publish", {
      sellerRoomId: this.opts.sellerRoomId,
      fingerprint: {
        version: fingerprint.version,
        userId: fingerprint.userId,
        sellerRoomId: fingerprint.sellerRoomId,
        meetingId: fingerprint.meetingId,
        seq: fingerprint.seq,
        windowDurationMs: fingerprint.windowDurationMs,
        captureMonoMs: fingerprint.captureMonoMs,
        captureServerMs,
        energyDbfs: fingerprint.energyDbfs,
        featureType: fingerprint.featureType,
        featureBytes: featuresToBase64(fingerprint.featureBytes),
      },
    });
  }

  async disconnect(): Promise<void> {
    this.joined = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.buffer.clear();
  }

  private joinRoom(): void {
    this.socket?.emit("join-seller-room", {
      sellerRoomId: this.opts.sellerRoomId,
      meetingId: this.opts.meetingId,
      tenantId: this.opts.tenantId,
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.socket?.emit("heartbeat", {
        sellerRoomId: this.opts.sellerRoomId,
      });
    }, 10_000);
  }

  private async calibrateClock(): Promise<void> {
    const offsets: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const offset = await this.probeOffset();
      if (offset != null) offsets.push(offset);
    }
    if (offsets.length > 0) {
      offsets.sort((a, b) => a - b);
      this.clockOffsetMs = offsets[Math.floor(offsets.length / 2)] ?? 0;
    }
  }

  private probeOffset(): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve(null);
        return;
      }
      const t0 = Date.now();
      const onResponse = (payload: {
        clientTimeMs?: number;
        serverTimeMs?: number;
      }) => {
        const t3 = Date.now();
        const clientTimeMs = Number(payload.clientTimeMs ?? t0);
        const serverTimeMs = Number(payload.serverTimeMs ?? t3);
        const rtt = t3 - t0;
        const offset = serverTimeMs - (clientTimeMs + rtt / 2);
        resolve(offset);
      };
      this.socket.once("clock-sync-response", onResponse);
      this.socket.emit("clock-sync", { clientTimeMs: t0 });
      setTimeout(() => {
        this.socket?.off("clock-sync-response", onResponse);
        resolve(null);
      }, 2000);
    });
  }
}

function wireToFingerprint(
  raw: Record<string, unknown>,
): AudioFingerprint | null {
  const featureBytesB64 = String(raw.featureBytes ?? "");
  if (!featureBytesB64) return null;
  const featureBytes = base64ToFeatures(featureBytesB64);
  const features = dequantizeFeatures(featureBytes);
  return {
    version: 1,
    userId: String(raw.userId ?? ""),
    sellerRoomId: String(raw.sellerRoomId ?? ""),
    meetingId: String(raw.meetingId ?? ""),
    seq: Number(raw.seq ?? 0),
    windowDurationMs: Number(raw.windowDurationMs ?? 200),
    captureMonoMs: Number(raw.captureMonoMs ?? 0),
    captureServerMs: Number(raw.captureServerMs ?? raw.captureMonoMs ?? 0),
    energyDbfs: Number(raw.energyDbfs ?? -120),
    featureType: "logmel_mfcc_v1",
    features,
    featureBytes,
  };
}
