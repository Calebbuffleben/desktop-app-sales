import assert from "node:assert/strict";
import {
  buildEgressAudioWsUrl,
  getEgressDefaults,
  httpBaseToWsBase,
  normalizeParticipantRole,
  resolveEffectiveMeetingId,
} from "../src/shared/egress-audio-protocol";
import { loadDesktopConfig } from "../src/shared/desktop-config";

function run(): void {
  const cfg = loadDesktopConfig();
  const defaults = getEgressDefaults(cfg);

  assert.equal(defaults.participantRole, "participant");
  assert.equal(normalizeParticipantRole("HOST"), "host");
  assert.equal(normalizeParticipantRole("bad"), undefined);

  const wsUrl = buildEgressAudioWsUrl({
    baseWs: defaults.baseWs,
    egressPath: defaults.egressPath,
    meetUrl: "https://meet.google.com/abc-defg-hij",
    participant: "operator-1",
    participantRole: "host",
    track: defaults.track,
    sampleRate: defaults.sampleRate,
    channels: defaults.channels,
  });

  const parsed = new URL(wsUrl);
  assert.equal(parsed.searchParams.get("participantRole"), "host");
  assert.equal(parsed.searchParams.get("participant"), "operator-1");

  const remoteWsUrl = buildEgressAudioWsUrl({
    baseWs: defaults.baseWs,
    egressPath: defaults.egressPath,
    meetUrl: "https://meet.google.com/abc-defg-hij",
    participant: "meet-remote",
    participantRole: defaults.participantRole,
    track: defaults.track,
    sampleRate: defaults.sampleRate,
    channels: defaults.channels,
  });
  assert.equal(new URL(remoteWsUrl).searchParams.get("participantRole"), "participant");

  const withoutRole = buildEgressAudioWsUrl({
    baseWs: defaults.baseWs,
    egressPath: defaults.egressPath,
    meetUrl: "https://meet.google.com/abc-defg-hij",
  });
  assert.equal(new URL(withoutRole).searchParams.get("participantRole"), null);

  assert.equal(
    httpBaseToWsBase("https://backend.example.com"),
    "wss://backend.example.com",
  );
  assert.equal(
    httpBaseToWsBase("http://localhost:3001"),
    "ws://localhost:3001",
  );

  assert.equal(
    resolveEffectiveMeetingId("https://meet.google.com/xyz-abcd-efg", ""),
    "xyz-abcd-efg",
  );
  assert.equal(resolveEffectiveMeetingId("", "custom-id"), "custom-id");

  console.log("[test-egress-audio-protocol] ok");
}

run();
