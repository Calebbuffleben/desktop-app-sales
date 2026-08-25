import { io, Socket } from "socket.io-client";

import type { MonitorSnapshot } from "@/types/desktop-api";

export type MonitorAlertEvent = {
  id: string;
  meetingId: string;
  kind: "red" | "yellow" | "sos";
  message: string;
  createdAt: string;
};

export type MonitorFloorClientOptions = {
  tenantId: string;
  httpBase: string;
  getAccessToken: () => Promise<string | null>;
  onSnapshot: (snapshot: MonitorSnapshot) => void;
  onAlert: (alert: MonitorAlertEvent) => void;
  onMeetingEnded?: (meetingId: string) => void;
};

export class MonitorFloorClient {
  private socket: Socket | null = null;

  constructor(private readonly options: MonitorFloorClientOptions) {}

  async start() {
    const token = await this.options.getAccessToken();
    if (!token) return;
    this.socket = io(`${this.options.httpBase}/monitor`, {
      transports: ["websocket"],
      auth: { token },
      extraHeaders: { Authorization: `Bearer ${token}` },
    });
    this.socket.on("connect", () => {
      this.socket?.emit("join-floor", { tenantId: this.options.tenantId });
    });
    this.socket.on("meeting-snapshot", (payload: MonitorSnapshot) => {
      this.options.onSnapshot(payload);
    });
    this.socket.on("alert", (payload: MonitorAlertEvent) => {
      this.options.onAlert(payload);
    });
    this.socket.on("meeting-ended", (payload: { meetingId?: string }) => {
      if (payload?.meetingId) this.options.onMeetingEnded?.(payload.meetingId);
    });
  }

  stop() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
