import {
  type AcousticFingerprintConfig,
  type AudioFingerprint,
  DEFAULT_FINGERPRINT_CONFIG,
  computeEnergyDbfs,
  pcm16ToFloat32,
  quantizeFeatures,
} from "./fingerprint-types";

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

function buildMelFilterbank(
  sampleRate: number,
  nFft: number,
  nMels: number,
): Float32Array[] {
  const lowMel = hzToMel(0);
  const highMel = hzToMel(sampleRate / 2);
  const melPoints = Array.from({ length: nMels + 2 }, (_, i) =>
    lowMel + ((highMel - lowMel) * i) / (nMels + 1),
  );
  const bins = melPoints.map((m) =>
    Math.floor(((nFft + 1) * melToHz(m)) / sampleRate),
  );
  const filters: Float32Array[] = [];
  const binsCount = nFft / 2 + 1;
  for (let i = 0; i < nMels; i += 1) {
    const filter = new Float32Array(binsCount);
    const left = bins[i] ?? 0;
    const center = bins[i + 1] ?? 0;
    const right = bins[i + 2] ?? 0;
    if (center <= left || right <= center) {
      filters.push(filter);
      continue;
    }
    for (let j = left; j < center; j += 1) {
      if (j >= 0 && j < binsCount) {
        filter[j] = (j - left) / Math.max(center - left, 1);
      }
    }
    for (let j = center; j < right; j += 1) {
      if (j >= 0 && j < binsCount) {
        filter[j] = (right - j) / Math.max(right - center, 1);
      }
    }
    filters.push(filter);
  }
  return filters;
}

function dctMatrix(nMfcc: number, nMels: number): Float32Array[] {
  const rows: Float32Array[] = [];
  const scale = Math.sqrt(2 / nMels);
  for (let k = 0; k < nMfcc; k += 1) {
    const row = new Float32Array(nMels);
    for (let n = 0; n < nMels; n += 1) {
      row[n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * nMels));
    }
    rows.push(row);
  }
  return rows;
}

function nextPow2(n: number): number {
  let v = 1;
  while (v < n) v <<= 1;
  return v;
}

/** Log-Mel + MFCC fingerprint extractor (TS port of Phase 0 Python spike). */
export class FingerprintGenerator {
  private readonly config: AcousticFingerprintConfig;
  private readonly nFft: number;
  private readonly frameLen: number;
  private readonly frameHop: number;
  private readonly melFilters: Float32Array[];
  private readonly dct: Float32Array[];
  private readonly hann: Float32Array;
  private seq = 0;
  private pcmCarry = new Int16Array(0);
  private captureMs = 0;

  constructor(config: Partial<AcousticFingerprintConfig> = {}) {
    this.config = { ...DEFAULT_FINGERPRINT_CONFIG, ...config };
    this.frameLen = Math.max(
      1,
      Math.floor((this.config.sampleRate * this.config.stftFrameMs) / 1000),
    );
    this.nFft = nextPow2(this.frameLen);
    this.frameHop = Math.max(
      1,
      Math.floor((this.config.sampleRate * this.config.stftHopMs) / 1000),
    );
    this.melFilters = buildMelFilterbank(
      this.config.sampleRate,
      this.nFft,
      this.config.melBands,
    );
    this.dct = dctMatrix(this.config.mfccCount, this.config.melBands);
    this.hann = new Float32Array(this.frameLen);
    for (let i = 0; i < this.frameLen; i += 1) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.frameLen - 1)));
    }
  }

  get window(): AcousticFingerprintConfig {
    return this.config;
  }

  windowSampleCount(): number {
    return Math.floor((this.config.sampleRate * this.config.windowMs) / 1000);
  }

  hopSampleCount(): number {
    return Math.floor((this.config.sampleRate * this.config.hopMs) / 1000);
  }

  reset(): void {
    this.seq = 0;
    this.pcmCarry = new Int16Array(0);
    this.captureMs = 0;
  }

  /** Push PCM frames; emit fingerprints when a full hop window is available. */
  pushPcm(
    pcm: Int16Array,
    meta: { userId: string; sellerRoomId: string; meetingId: string },
  ): AudioFingerprint[] {
    const merged = new Int16Array(this.pcmCarry.length + pcm.length);
    merged.set(this.pcmCarry, 0);
    merged.set(pcm, this.pcmCarry.length);
    const win = this.windowSampleCount();
    const hop = this.hopSampleCount();
    const out: AudioFingerprint[] = [];
    let offset = 0;
    while (offset + win <= merged.length) {
      const slice = merged.subarray(offset, offset + win);
      const fp = this.fingerprintFromPcm(slice, {
        ...meta,
        seq: this.seq,
        captureMonoMs: this.captureMs,
      });
      if (fp) out.push(fp);
      this.seq += 1;
      this.captureMs += this.config.hopMs;
      offset += hop;
    }
    this.pcmCarry = merged.subarray(offset);
    return out;
  }

  fingerprintFromPcm(
    pcm: Int16Array,
    meta: {
      userId: string;
      sellerRoomId: string;
      meetingId: string;
      seq: number;
      captureMonoMs: number;
    },
  ): AudioFingerprint | null {
    const samples = pcm16ToFloat32(pcm);
    const energy = computeEnergyDbfs(samples);
    if (energy < this.config.fingerprintMinDbfs) return null;
    const features = this.extractFeatures(samples);
    if (features.length === 0) return null;
    return {
      version: 1,
      userId: meta.userId,
      sellerRoomId: meta.sellerRoomId,
      meetingId: meta.meetingId,
      seq: meta.seq,
      windowDurationMs: this.config.windowMs,
      captureMonoMs: meta.captureMonoMs,
      energyDbfs: energy,
      featureType: "logmel_mfcc_v1",
      features,
      featureBytes: quantizeFeatures(features),
    };
  }

  extractFeatures(window: Float32Array): Float32Array {
    const melFrames: Float32Array[] = [];
    for (let pos = 0; pos + this.frameLen <= window.length; pos += this.frameHop) {
      const frame = new Float32Array(this.nFft);
      for (let i = 0; i < this.frameLen; i += 1) {
        frame[i] = (window[pos + i] ?? 0) * (this.hann[i] ?? 0);
      }
      const power = rfftPower(frame);
      const mel = new Float32Array(this.config.melBands);
      for (let m = 0; m < this.config.melBands; m += 1) {
        const filter = this.melFilters[m]!;
        let sum = 0;
        for (let j = 0; j < filter.length; j += 1) {
          sum += (filter[j] ?? 0) * (power[j] ?? 0);
        }
        mel[m] = Math.log(Math.max(sum, 1e-10));
      }
      melFrames.push(mel);
    }
    if (melFrames.length === 0) return new Float32Array(0);

    const melMean = new Float32Array(this.config.melBands);
    const melStd = new Float32Array(this.config.melBands);
    for (let m = 0; m < this.config.melBands; m += 1) {
      let sum = 0;
      for (const frame of melFrames) sum += frame[m] ?? 0;
      melMean[m] = sum / melFrames.length;
      let varSum = 0;
      for (const frame of melFrames) {
        const d = (frame[m] ?? 0) - (melMean[m] ?? 0);
        varSum += d * d;
      }
      melStd[m] = Math.sqrt(varSum / melFrames.length);
    }

    const mfcc = new Float32Array(this.config.mfccCount);
    for (let k = 0; k < this.config.mfccCount; k += 1) {
      let sum = 0;
      const row = this.dct[k]!;
      for (let n = 0; n < this.config.melBands; n += 1) {
        sum += (row[n] ?? 0) * (melMean[n] ?? 0);
      }
      mfcc[k] = sum;
    }
    const delta = new Float32Array(this.config.mfccCount);
    delta[0] = 0;
    for (let k = 1; k < this.config.mfccCount; k += 1) {
      delta[k] = (mfcc[k] ?? 0) - (mfcc[k - 1] ?? 0);
    }

    const vector = new Float32Array(
      this.config.melBands * 2 + this.config.mfccCount * 2,
    );
    vector.set(melMean, 0);
    vector.set(melStd, this.config.melBands);
    vector.set(mfcc, this.config.melBands * 2);
    vector.set(delta, this.config.melBands * 2 + this.config.mfccCount);

    let norm = 0;
    for (let i = 0; i < vector.length; i += 1) norm += (vector[i] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i += 1) vector[i] = (vector[i] ?? 0) / norm;
    }
    return vector;
  }
}

/** Minimal real FFT power spectrum via DFT (window is short; OK for 200ms spike). */
function rfftPower(frame: Float32Array): Float32Array {
  const n = frame.length;
  const out = new Float32Array(n / 2 + 1);
  for (let k = 0; k < out.length; k += 1) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = (-2 * Math.PI * k * t) / n;
      const v = frame[t] ?? 0;
      re += v * Math.cos(angle);
      im += v * Math.sin(angle);
    }
    out[k] = re * re + im * im;
  }
  return out;
}
