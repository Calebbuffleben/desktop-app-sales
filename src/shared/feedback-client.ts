import { io, Socket } from "socket.io-client";

export type FeedbackPayload = {
  id?: string;
  meetingId?: string;
  participantId?: string;
  type?: string;
  severity?: "info" | "warning" | "critical";
  ts?: number | string;
  message?: string;
  tips?: string[];
  metadata?: Record<string, unknown>;
};

export type FeedbackClientOptions = {
  meetingId: string;
  httpBase: string;
  onFeedback: (payload: FeedbackPayload) => void;
  onStatus?: (status: string) => void;
  onState?: (state: FeedbackConnectionState) => void;
  forcePolling?: boolean;
  debug?: boolean;
};

const POLL_INTERVAL_MS = 2000;
export type FeedbackConnectionState = {
  socketStatus: "idle" | "connecting" | "connected" | "disconnected" | "error";
  pollingActive: boolean;
  forcePolling: boolean;
  reconnectAttempt: number;
  nextReconnectInMs?: number;
  lastError?: string;
  lastLatencyMs?: number;
};

function normalizeRecentPayload(event: Record<string, unknown>): FeedbackPayload {
  const metadata =
    event.metadata && typeof event.metadata === "object"
      ? (event.metadata as Record<string, unknown>)
      : undefined;
  const tips = Array.isArray(metadata?.tips)
    ? (metadata?.tips as string[])
    : [];

  return {
    id: typeof event.id === "string" ? event.id : undefined,
    meetingId: typeof event.meetingId === "string" ? event.meetingId : undefined,
    participantId:
      typeof event.participantId === "string" ? event.participantId : undefined,
    type: typeof event.type === "string" ? event.type : "llm_insight",
    severity:
      event.severity === "warning" || event.severity === "critical"
        ? event.severity
        : "info",
    ts: (event.ts as number | string | undefined) ?? Date.now(),
    message: typeof event.message === "string" ? event.message : "",
    tips,
    metadata,
  };
}

export class DesktopFeedbackClient {
  private readonly opts: FeedbackClientOptions;
  private readonly seenIds = new Set<string>();
  private readonly seenKeys = new Set<string>();
  private socket: Socket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private baselineDone = false;
  private state: FeedbackConnectionState = {
    socketStatus: "idle",
    pollingActive: false,
    forcePolling: false,
    reconnectAttempt: 0,
  };

  constructor(opts: FeedbackClientOptions) {
    this.opts = opts;
  }

  private status(message: string): void {
    this.opts.onStatus?.(message);
    if (this.opts.debug) this.opts.onStatus?.(`[debug] ${message}`);
  }

  private setState(next: Partial<FeedbackConnectionState>): void {
    this.state = { ...this.state, ...next };
    this.opts.onState?.(this.state);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.setState({ pollingActive: false });
  }

  private handleIncoming(payload: FeedbackPayload): void {
    const eventId = payload.id ? String(payload.id) : "";
    if (eventId) {
      if (this.seenIds.has(eventId)) return;
      this.seenIds.add(eventId);
    } else {
      const key = `${String(payload.ts || "")}|${payload.type || ""}|${payload.message || ""}`;
      if (this.seenKeys.has(key)) return;
      this.seenKeys.add(key);
    }
    const latency = (() => {
      if (!payload.ts) return undefined;
      const tsMs = new Date(payload.ts).getTime();
      if (!Number.isFinite(tsMs)) return undefined;
      return Math.max(0, Date.now() - tsMs);
    })();
    if (typeof latency === "number") {
      this.setState({ lastLatencyMs: latency });
    }
    this.opts.onFeedback(payload);
  }

  private async pollOnce(): Promise<void> {
    const url = `${this.opts.httpBase}/feedback/metrics/${encodeURIComponent(this.opts.meetingId)}`;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { recent?: Record<string, unknown>[] };
      if (!Array.isArray(data.recent) || data.recent.length === 0) return;

      const ordered = [...data.recent].sort((a, b) => {
        const ta = Number(new Date((a.ts as string | number | undefined) ?? 0).getTime());
        const tb = Number(new Date((b.ts as string | number | undefined) ?? 0).getTime());
        return ta - tb;
      });

      if (!this.baselineDone) {
        for (const event of ordered) {
          const id = typeof event.id === "string" ? event.id : "";
          if (id) {
            this.seenIds.add(id);
          } else {
            const normalized = normalizeRecentPayload(event);
            const key = `${String(normalized.ts || "")}|${normalized.type || ""}|${normalized.message || ""}`;
            this.seenKeys.add(key);
          }
        }
        this.baselineDone = true;
        this.status("feedback polling baseline ready");
        return;
      }

      for (const event of ordered) {
        this.handleIncoming(normalizeRecentPayload(event));
      }
    } catch (error) {
      this.status(
        `feedback polling error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.status("feedback polling enabled");
    this.setState({ pollingActive: true });
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    void this.pollOnce();
  }

  start(): void {
    this.stop();
    this.baselineDone = false;
    this.seenIds.clear();
    this.seenKeys.clear();
    this.setState({
      socketStatus: this.opts.forcePolling ? "idle" : "connecting",
      forcePolling: Boolean(this.opts.forcePolling),
      reconnectAttempt: 0,
      nextReconnectInMs: undefined,
      lastError: undefined,
    });

    if (this.opts.forcePolling) {
      this.status("feedback running in forced polling mode");
      this.startPolling();
      return;
    }

    this.socket = io(this.opts.httpBase, {
      transports: ["websocket"],
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on("connect", () => {
      this.status("feedback socket connected");
      this.setState({
        socketStatus: "connected",
        reconnectAttempt: 0,
        nextReconnectInMs: undefined,
        lastError: undefined,
      });
      this.socket?.emit("join-room", `feedback:${this.opts.meetingId}`);
    });

    this.socket.on("room-joined", (payload: { recent?: Record<string, unknown>[] }) => {
      this.status("feedback room joined");
      this.baselineDone = true;
      this.stopPolling();
      if (Array.isArray(payload?.recent)) {
        for (const event of payload.recent) {
          const normalized = normalizeRecentPayload(event);
          const eventId = normalized.id ? String(normalized.id) : "";
          if (eventId) {
            this.seenIds.add(eventId);
          } else {
            const key = `${String(normalized.ts || "")}|${normalized.type || ""}|${normalized.message || ""}`;
            this.seenKeys.add(key);
          }
        }
      }
    });

    this.socket.on("feedback", (payload: FeedbackPayload) => {
      this.handleIncoming(payload);
    });

    this.socket.on("disconnect", () => {
      this.status("feedback socket disconnected -> polling fallback");
      this.setState({ socketStatus: "disconnected" });
      this.startPolling();
    });

    this.socket.on("connect_error", (error: Error) => {
      this.status(`feedback socket error: ${error.message}`);
      this.setState({
        socketStatus: "error",
        lastError: error.message,
      });
      this.startPolling();
    });

    this.socket.io.on("reconnect_attempt", (attempt: number) => {
      const retryMs = Math.min(8000, 1000 * Math.max(1, attempt));
      this.setState({
        reconnectAttempt: attempt,
        nextReconnectInMs: retryMs,
      });
      this.status(`feedback reconnect attempt ${attempt} (next ~${retryMs}ms)`);
    });

    this.startPolling();
  }

  stop(): void {
    this.stopPolling();
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch {}
      this.socket = null;
    }
    this.setState({
      socketStatus: "idle",
      pollingActive: false,
      reconnectAttempt: 0,
      nextReconnectInMs: undefined,
    });
  }
}

