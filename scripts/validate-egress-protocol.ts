import WebSocket from "ws";
import { loadDesktopConfig } from "../src/shared/desktop-config";
import {
  buildEgressAudioWsUrl,
  buildPcm16SilentFrame,
  getEgressDefaults,
} from "../src/shared/egress-audio-protocol";

async function run(): Promise<void> {
  const cfg = loadDesktopConfig();
  const defaults = getEgressDefaults(cfg);

  const meetUrl = process.env.MEET_URL || "https://meet.google.com/abc-defg-hij";
  const meetingId = process.env.MEETING_ID;
  const participant = process.env.PARTICIPANT || defaults.participant;
  const track = process.env.TRACK || defaults.track;
  const sampleRate = Number(process.env.SAMPLE_RATE || defaults.sampleRate);
  const channels = Number(process.env.CHANNELS || defaults.channels);

  const wsUrl = buildEgressAudioWsUrl({
    baseWs: defaults.baseWs,
    egressPath: defaults.egressPath,
    meetUrl,
    meetingId,
    participant,
    track,
    sampleRate,
    channels,
  });

  const payload = buildPcm16SilentFrame(sampleRate, channels);
  console.log(`[validate-egress] wsUrl=${wsUrl}`);
  console.log(
    `[validate-egress] payloadBytes=${payload.length} sampleRate=${sampleRate} channels=${channels}`,
  );

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      reject(new Error("timeout waiting for handshake"));
    }, 5000);

    ws.on("open", () => {
      ws.send(payload, { binary: true }, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }
        setTimeout(() => {
          try {
            ws.close(1000, "cli-validate-protocol");
          } catch {}
        }, 100);
      });
    });

    ws.on("close", (code) => {
      clearTimeout(timeout);
      console.log(`[validate-egress] success closeCode=${code}`);
      resolve();
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[validate-egress] failed: ${message}`);
  process.exitCode = 1;
});

