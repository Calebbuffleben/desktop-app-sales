import { FingerprintBuffer } from "./fingerprint-buffer";
import { FingerprintGenerator } from "./fingerprint-generator";
import {
  type AcousticClass,
  type AcousticFingerprintConfig,
  type AudioFingerprint,
  type CorrelationResult,
  DEFAULT_FINGERPRINT_CONFIG,
  computeEnergyDbfs,
  cosineSimilarity,
  pcm16ToFloat32,
} from "./fingerprint-types";

/** Multi-window lag search correlator with hysteresis and EMA lag lock. */
export class FingerprintCorrelator {
  private readonly config: AcousticFingerprintConfig;
  private readonly generator: FingerprintGenerator;
  private readonly recentLabels: AcousticClass[] = [];
  private readonly lagEma = new Map<string, number>();
  private pcmCarry = new Int16Array(0);
  private captureMs = 0;
  private seq = 0;

  constructor(
    config: Partial<AcousticFingerprintConfig> = {},
    generator?: FingerprintGenerator,
  ) {
    this.config = { ...DEFAULT_FINGERPRINT_CONFIG, ...config };
    this.generator = generator ?? new FingerprintGenerator(this.config);
  }

  reset(): void {
    this.pcmCarry = new Int16Array(0);
    this.captureMs = 0;
    this.seq = 0;
    this.recentLabels.length = 0;
    this.lagEma.clear();
  }

  pushLoopback(
    pcm: Int16Array,
    buffer: FingerprintBuffer,
    meta: { sellerRoomId: string; meetingId: string },
  ): CorrelationResult[] {
    const merged = new Int16Array(this.pcmCarry.length + pcm.length);
    merged.set(this.pcmCarry, 0);
    merged.set(pcm, this.pcmCarry.length);
    const win = this.generator.windowSampleCount();
    const hop = this.generator.hopSampleCount();
    const results: CorrelationResult[] = [];
    let offset = 0;
    while (offset + win <= merged.length) {
      const slice = merged.subarray(offset, offset + win);
      results.push(
        this.correlateWindow(slice, {
          captureTimeMs: this.captureMs,
          buffer,
          loopbackSeq: this.seq,
          sellerRoomId: meta.sellerRoomId,
          meetingId: meta.meetingId,
        }),
      );
      this.seq += 1;
      this.captureMs += this.config.hopMs;
      offset += hop;
    }
    this.pcmCarry = merged.subarray(offset);
    return results;
  }

  correlateWindow(
    pcm: Int16Array,
    opts: {
      captureTimeMs: number;
      buffer: FingerprintBuffer;
      loopbackSeq: number;
      sellerRoomId: string;
      meetingId: string;
    },
  ): CorrelationResult {
    const samples = pcm16ToFloat32(pcm);
    const energy = computeEnergyDbfs(samples);
    const loopFp = this.generator.fingerprintFromPcm(pcm, {
      userId: "loopback",
      sellerRoomId: opts.sellerRoomId,
      meetingId: opts.meetingId,
      seq: opts.loopbackSeq,
      captureMonoMs: opts.captureTimeMs,
    });

    if (!loopFp || energy < this.config.fingerprintMinDbfs) {
      return emptyResult("unknown");
    }

    const sellerScores: Array<{ id: string; score: number; lag: number }> = [];
    for (const sellerId of opts.buffer.allUserIds()) {
      const remote = opts.buffer.candidates(
        sellerId,
        opts.captureTimeMs,
        this.config.maxLagMs,
      );
      if (remote.length === 0) continue;
      const [score, lag] = this.bestMatchForSeller([loopFp], remote, sellerId);
      sellerScores.push({ id: sellerId, score, lag });
    }

    if (sellerScores.length === 0) {
      return emptyResult("customer");
    }

    sellerScores.sort((a, b) => b.score - a.score);
    const best = sellerScores[0]!;
    const second = sellerScores[1]?.score ?? 0;
    const margin = best.score - second;

    let candidate: AcousticClass = "unknown";
    let matchedId: string | undefined;
    if (
      best.score >= this.config.sellerThreshold &&
      margin >= this.config.marginThreshold
    ) {
      candidate = "seller";
      matchedId = best.id;
      this.updateLagEma(best.id, best.lag);
    } else if (best.score <= this.config.customerThreshold) {
      candidate = "customer";
    } else {
      candidate = "customer";
    }

    const finalClass = this.applyHysteresis(candidate);
    const windowEndMs = opts.captureTimeMs + this.config.windowMs;
    return {
      acousticClass: finalClass,
      matchedSellerId: finalClass === "seller" ? matchedId : undefined,
      confidence: best.score,
      lagMs: best.lag,
      bestScore: best.score,
      secondBestScore: second,
      windowStartMs: opts.captureTimeMs,
      windowEndMs,
    };
  }

  private bestMatchForSeller(
    loopbackFps: AudioFingerprint[],
    remoteFps: AudioFingerprint[],
    sellerId: string,
  ): [number, number] {
    const locked = this.lagEma.get(sellerId);
    const lags: number[] = [];
    if (locked != null) {
      for (
        let lag = locked - 200;
        lag <= locked + 200;
        lag += this.config.lagStepMs
      ) {
        lags.push(lag);
      }
    } else {
      for (
        let lag = -this.config.maxLagMs;
        lag <= this.config.maxLagMs;
        lag += this.config.lagStepMs
      ) {
        lags.push(lag);
      }
    }
    let bestScore = 0;
    let bestLag = 0;
    for (const lag of lags) {
      const score = this.sequenceScore(loopbackFps, remoteFps, lag);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    return [bestScore, bestLag];
  }

  private sequenceScore(
    loopbackFps: AudioFingerprint[],
    remoteFps: AudioFingerprint[],
    lagMs: number,
  ): number {
    const scores: number[] = [];
    for (const loopFp of loopbackFps) {
      const target = loopFp.captureMonoMs - lagMs;
      let best = 0;
      for (const remote of remoteFps) {
        const t = remote.captureServerMs ?? remote.captureMonoMs;
        if (Math.abs(t - target) <= this.config.hopMs) {
          best = Math.max(best, cosineSimilarity(loopFp.features, remote.features));
        }
      }
      scores.push(best);
    }
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private applyHysteresis(candidate: AcousticClass): AcousticClass {
    this.recentLabels.push(candidate);
    while (this.recentLabels.length > this.config.hysteresisM) {
      this.recentLabels.shift();
    }
    if (candidate !== "seller") return candidate;
    const sellerCount = this.recentLabels.filter((l) => l === "seller").length;
    return sellerCount >= this.config.hysteresisK ? "seller" : "unknown";
  }

  private updateLagEma(sellerId: string, lag: number): void {
    const prev = this.lagEma.get(sellerId);
    if (prev == null) this.lagEma.set(sellerId, lag);
    else this.lagEma.set(sellerId, prev * 0.7 + lag * 0.3);
  }
}

function emptyResult(acousticClass: AcousticClass): CorrelationResult {
  return {
    acousticClass,
    confidence: 0,
    lagMs: 0,
    bestScore: 0,
    secondBestScore: 0,
  };
}
