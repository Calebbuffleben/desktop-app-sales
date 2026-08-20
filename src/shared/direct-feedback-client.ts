import { normalizeFeedbackPayload, type FeedbackPayload } from "./feedback-client";
import { normalizeWsBase } from "./egress-audio-protocol";

/**
 * Feedback direto do python-service via WebSocket (bypass do backend).
 *
 * Conecta em `PYTHON_WS_BASE + PYTHON_WS_PATH` com `mode=feedback` e recebe
 * frames JSON `{ type: "feedback", payload: {...} }` no mesmo formato do
 * evento Socket.IO `feedback` do backend — a normalização é compartilhada.
 */

export type DirectFeedbackClientOptions = {
  meetingId: string;
  tenantId: string;
  /** Base WS do python-service (ex: ws://localhost:8000). */
  pythonWsBase: string;
  /** Path do gateway (default /ws). */
  pythonWsPath?: string;
  getAccessToken: () => Promise<string | null>;
  onFeedback: (payload: FeedbackPayload) => void;
  onStatus?: (status: string) => void;
  debug?: boolean;
};

const MAX_RECONNECT_DELAY_MS = 8000;

export class DirectFeedbackClient {
  private readonly opts: DirectFeedbackClientOptions;
  private readonly seenIds = new Set<string>();
  private ws: WebSocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: DirectFeedbackClientOptions) {
    this.opts = opts;
  }

  private status(message: string): void {
    this.opts.onStatus?.(message);
    if (this.opts.debug) console.log(`[direct-feedback] ${message}`);
  }

  private async buildUrl(): Promise<string | null> {
    const token = await this.opts.getAccessToken();
    if (!token) return null;
    const base = normalizeWsBase(this.opts.pythonWsBase, "https://meet.google.com/");
    const url = new URL(base);
    url.pathname = this.opts.pythonWsPath || "/ws";
    url.searchParams.set("mode", "feedback");
    url.searchParams.set("meetingId", this.opts.meetingId);
    url.searchParams.set("tenantId", this.opts.tenantId);
    url.searchParams.set("token", token);
    return url.toString();
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      500 * Math.pow(2, this.reconnectAttempt - 1),
    );
    this.status(
      `direct feedback reconnect in ${delay}ms (attempt ${this.reconnectAttempt}): ${reason}`,
    );
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const envelope = parsed as { type?: string; payload?: Record<string, unknown> };
    if (envelope.type !== "feedback" || !envelope.payload) return;

    const payload = normalizeFeedbackPayload(envelope.payload);
    const id = payload.id ? String(payload.id) : "";
    if (id) {
      if (this.seenIds.has(id)) return;
      this.seenIds.add(id);
    }
    const meta = (payload.metadata || {}) as Record<string, unknown>;
    const speechAnchor =
      Number(meta.speechAnchorMs ?? meta.speechEndMs ?? meta.windowEndMs ?? 0) || 0;
    if (speechAnchor > 0) {
      const perceivedMs = Math.max(0, Date.now() - speechAnchor);
      if (this.opts.debug || perceivedMs > 1000) {
        console.log(
          `[direct-feedback] client.feedback_received perceivedMs=${perceivedMs} turnId=${String(
            meta.turnId || "",
          )} traceId=${String(meta.feedbackTraceId || "")}`,
        );
      }
    }
    this.opts.onFeedback(payload);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let url: string | null;
    try {
      url = await this.buildUrl();
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!url) {
      this.status("direct feedback idle: not authenticated");
      this.scheduleReconnect("unauthenticated");
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : String(err));
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.status("direct feedback connected (python-service)");
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") this.handleMessage(event.data);
    };
    ws.onclose = (event: CloseEvent) => {
      if (this.stopped) return;
      this.scheduleReconnect(
        event.reason?.trim() || `close code ${event.code || "n/a"}`,
      );
    };
  }

  async start(): Promise<void> {
    this.stop();
    this.stopped = false;
    this.seenIds.clear();
    this.reconnectAttempt = 0;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.close(1000, "direct-feedback-stop");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
