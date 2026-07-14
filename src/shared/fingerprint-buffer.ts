import type { AudioFingerprint } from "./fingerprint-types";
import { DEFAULT_FINGERPRINT_CONFIG } from "./fingerprint-types";

/** Per-user ring buffer of remote fingerprints with TTL pruning. */
export class FingerprintBuffer {
  private readonly byUser = new Map<string, AudioFingerprint[]>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_FINGERPRINT_CONFIG.bufferTtlMs) {
    this.ttlMs = ttlMs;
  }

  clear(): void {
    this.byUser.clear();
  }

  add(fp: AudioFingerprint): void {
    const list = this.byUser.get(fp.userId) ?? [];
    list.push(fp);
    this.byUser.set(fp.userId, list);
    this.prune(Date.now());
  }

  addMany(fps: AudioFingerprint[]): void {
    for (const fp of fps) this.add(fp);
  }

  allUserIds(): string[] {
    return [...this.byUser.keys()];
  }

  candidates(
    userId: string,
    centerMs: number,
    maxLagMs: number,
  ): AudioFingerprint[] {
    const list = this.byUser.get(userId) ?? [];
    return list.filter((fp) => {
      const t = fp.captureServerMs ?? fp.captureMonoMs;
      return Math.abs(t - centerMs) <= maxLagMs;
    });
  }

  prune(nowMs: number): void {
    for (const [userId, list] of this.byUser.entries()) {
      const kept = list.filter((fp) => {
        const t = fp.captureServerMs ?? fp.captureMonoMs;
        return nowMs - t <= this.ttlMs;
      });
      if (kept.length === 0) this.byUser.delete(userId);
      else this.byUser.set(userId, kept);
    }
  }
}
