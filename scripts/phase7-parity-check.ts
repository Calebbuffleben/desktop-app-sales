import WebSocket from "ws";
import { io } from "socket.io-client";
import { loadDesktopConfig } from "../src/shared/desktop-config";
import {
  buildEgressAudioWsUrl,
  buildPcm16SilentFrame,
  getEgressDefaults,
  wsToHttpBase,
} from "../src/shared/egress-audio-protocol";

type SyntheticFeedback = {
  id: string;
  meetingId: string;
  participantId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  ts: string;
  message: string;
};

const REALTIME_LATENCY_MAX_MS = Number(process.env.PARITY_MAX_LATENCY_MS || 3500);
const RECOVERY_MAX_MS = Number(process.env.PARITY_MAX_RECOVERY_MS || 7000);

function randomMeetingId(): string {
  return `phase7-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function validateEgressProtocol(meetingId: string): Promise<void> {
  const cfg = loadDesktopConfig();
  const defaults = getEgressDefaults(cfg);
  const wsUrl = buildEgressAudioWsUrl({
    baseWs: defaults.baseWs,
    egressPath: defaults.egressPath,
    meetUrl: `https://meet.google.com/${meetingId}`,
    meetingId,
    participant: "desktop-parity-test",
    track: "desktop-phase7-track",
    sampleRate: defaults.sampleRate,
    channels: defaults.channels,
  });
  const payload = buildPcm16SilentFrame(defaults.sampleRate, defaults.channels);
  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      reject(new Error("timeout waiting egress handshake"));
    }, 7000);

    ws.on("open", () => {
      ws.send(payload, { binary: true }, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }
        setTimeout(() => ws.close(1000, "phase7-egress-check"), 120);
      });
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      console.log(`[phase7] protocol WS ok in ${Date.now() - t0}ms`);
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function postSyntheticFeedback(
  httpBase: string,
  payload: {
    meetingId: string;
    severity: "info" | "warning" | "critical";
    message: string;
  },
): Promise<SyntheticFeedback> {
  const response = await fetch(`${httpBase}/feedback/test/emit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      participantId: "desktop-phase7",
      type: "llm_insight",
      tsMs: Date.now(),
      metadata: { tips: ["phase7 parity"] },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`emit failed HTTP ${response.status}: ${body}`);
  }
  return (await response.json()) as SyntheticFeedback;
}

async function waitForPollingRecent(
  httpBase: string,
  meetingId: string,
  messageToken: string,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < RECOVERY_MAX_MS) {
    const response = await fetch(
      `${httpBase}/feedback/metrics/${encodeURIComponent(meetingId)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as {
        recent?: Array<{ message?: string; ts?: string }>;
      };
      const hit = (data.recent || []).find((row) =>
        String(row.message || "").includes(messageToken),
      );
      if (hit) {
        return Date.now() - started;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("polling fallback did not recover in time");
}

async function run(): Promise<void> {
  const cfg = loadDesktopConfig();
  const wsBase = cfg.BACKEND_WS_BASE;
  const httpBase = process.env.BACKEND_HTTP_BASE || wsToHttpBase(wsBase);
  const meetingId = process.env.PARITY_MEETING_ID || randomMeetingId();
  const room = `feedback:${meetingId}`;

  console.log(`[phase7] meetingId=${meetingId}`);
  console.log(`[phase7] backend=http ${httpBase} | ws ${wsBase}`);

  await validateEgressProtocol(meetingId);

  const socket = io(httpBase, {
    transports: ["websocket"],
    withCredentials: false,
    reconnection: true,
    reconnectionAttempts: 4,
    reconnectionDelay: 800,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket connect timeout")), 7000);
    socket.on("connect", () => {
      socket.emit("join-room", room);
    });
    socket.on("room-joined", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  console.log("[phase7] socket room joined");

  const tokenRealtime = `phase7-realtime-${Date.now()}`;
  const emitRealtime = await postSyntheticFeedback(httpBase, {
    meetingId,
    severity: "warning",
    message: tokenRealtime,
  });

  const realtimeLatency = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("realtime feedback not received")),
      REALTIME_LATENCY_MAX_MS + 2000,
    );
    const onFeedback = (payload: { message?: string; ts?: string }) => {
      if (!String(payload.message || "").includes(tokenRealtime)) return;
      clearTimeout(timeout);
      socket.off("feedback", onFeedback);
      const sourceTs = payload.ts ? new Date(payload.ts).getTime() : Date.now();
      resolve(Math.max(0, Date.now() - sourceTs));
    };
    socket.on("feedback", onFeedback);
  });

  if (realtimeLatency > REALTIME_LATENCY_MAX_MS) {
    throw new Error(
      `realtime latency ${realtimeLatency}ms exceeded ${REALTIME_LATENCY_MAX_MS}ms`,
    );
  }
  console.log(
    `[phase7] realtime feedback OK id=${emitRealtime.id} latency=${realtimeLatency}ms`,
  );

  socket.disconnect();
  console.log("[phase7] socket disconnected to validate polling fallback");

  const tokenPolling = `phase7-polling-${Date.now()}`;
  await postSyntheticFeedback(httpBase, {
    meetingId,
    severity: "critical",
    message: tokenPolling,
  });
  const pollingRecoveryMs = await waitForPollingRecent(
    httpBase,
    meetingId,
    tokenPolling,
  );
  if (pollingRecoveryMs > RECOVERY_MAX_MS) {
    throw new Error(
      `polling recovery ${pollingRecoveryMs}ms exceeded ${RECOVERY_MAX_MS}ms`,
    );
  }
  console.log(`[phase7] polling fallback OK recovery=${pollingRecoveryMs}ms`);

  socket.connect();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket reconnect timeout")), 7000);
    socket.on("connect", () => {
      socket.emit("join-room", room);
    });
    socket.on("room-joined", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const tokenRecovery = `phase7-recovery-${Date.now()}`;
  await postSyntheticFeedback(httpBase, {
    meetingId,
    severity: "info",
    message: tokenRecovery,
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("socket recovery feedback not received")),
      6000,
    );
    const onFeedback = (payload: { message?: string }) => {
      if (!String(payload.message || "").includes(tokenRecovery)) return;
      clearTimeout(timeout);
      socket.off("feedback", onFeedback);
      resolve();
    };
    socket.on("feedback", onFeedback);
  });
  socket.close();
  console.log("[phase7] socket recovery OK");

  console.log("\n[phase7] PARITY CHECK PASSED");
  console.log(
    JSON.stringify(
      {
        meetingId,
        realtimeLatencyMs: realtimeLatency,
        pollingRecoveryMs,
        thresholds: {
          realtimeLatencyMaxMs: REALTIME_LATENCY_MAX_MS,
          recoveryMaxMs: RECOVERY_MAX_MS,
        },
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[phase7] failed: ${message}`);
  process.exitCode = 1;
});
