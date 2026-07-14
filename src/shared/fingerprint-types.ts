/** Shared types for Seller Room acoustic fingerprints (desktop). */

export type AcousticClass = "seller" | "customer" | "unknown";

export type AudioFingerprint = {
  version: 1;
  userId: string;
  sellerRoomId: string;
  meetingId: string;
  seq: number;
  windowDurationMs: number;
  captureMonoMs: number;
  captureServerMs?: number;
  energyDbfs: number;
  featureType: "logmel_mfcc_v1";
  /** Float32 features (local only). */
  features: Float32Array;
  /** Quantized Int8 for wire. */
  featureBytes: Uint8Array;
};

export type CorrelationResult = {
  acousticClass: AcousticClass;
  matchedSellerId?: string;
  confidence: number;
  lagMs: number;
  windowStartMs?: number;
  windowEndMs?: number;
  bestScore: number;
  secondBestScore: number;
};

export type AcousticFingerprintConfig = {
  sampleRate: number;
  windowMs: number;
  hopMs: number;
  stftFrameMs: number;
  stftHopMs: number;
  melBands: number;
  mfccCount: number;
  fingerprintMinDbfs: number;
  bufferTtlMs: number;
  maxLagMs: number;
  lagStepMs: number;
  sequenceWindows: number;
  sellerThreshold: number;
  customerThreshold: number;
  marginThreshold: number;
  hysteresisK: number;
  hysteresisM: number;
};

export const DEFAULT_FINGERPRINT_CONFIG: AcousticFingerprintConfig = {
  sampleRate: 16000,
  windowMs: 200,
  hopMs: 100,
  stftFrameMs: 25,
  stftHopMs: 10,
  melBands: 32,
  mfccCount: 13,
  fingerprintMinDbfs: -50,
  bufferTtlMs: 5000,
  maxLagMs: 1200,
  lagStepMs: 100,
  sequenceWindows: 3,
  sellerThreshold: 0.72,
  customerThreshold: 0.45,
  marginThreshold: 0.08,
  hysteresisK: 3,
  hysteresisM: 4,
};

export function quantizeFeatures(features: Float32Array): Uint8Array {
  const out = new Uint8Array(features.length);
  for (let i = 0; i < features.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, features[i] ?? 0));
    out[i] = (Math.round(clamped * 127) + 128) & 0xff;
  }
  return out;
}

export function dequantizeFeatures(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = ((bytes[i] ?? 128) - 128) / 127;
  }
  return out;
}

export function featuresToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

export function base64ToFeatures(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export function pcm16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, (pcm[i] ?? 0) / 32768));
  }
  return out;
}

export function computeEnergyDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -120;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return -120;
  return 20 * Math.log10(rms);
}
