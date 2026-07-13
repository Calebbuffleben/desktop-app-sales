import { concatPcm16Chunks } from "./wav-writer";

export type AcousticCorpusLabel = {
  start_ms: number;
  end_ms: number;
  ground_truth: "seller" | "customer" | "unknown";
  matched_seller_id?: string;
};

export type AcousticCorpusManifest = {
  session_id: string;
  scenario: string;
  seller_user_id: string;
  listener_user_id: string;
  meeting_id: string;
  seller_room_id: string;
  sample_rate: number;
  channels: number;
  simulated_lag_ms: number;
  labels: AcousticCorpusLabel[];
};

export type AcousticCorpusSaveInput = {
  manifest: AcousticCorpusManifest;
  micPcm: Int16Array;
  loopbackPcm: Int16Array;
};

export function buildScenarioLabels(
  scenario: string,
  durationMs: number,
  sellerUserId?: string,
): AcousticCorpusLabel[] {
  const groundTruth: AcousticCorpusLabel["ground_truth"] =
    scenario === "self_roundtrip"
      ? "seller"
      : scenario === "customer_only"
        ? "customer"
        : "unknown";

  return [
    {
      start_ms: 0,
      end_ms: Math.max(1, durationMs),
      ground_truth: groundTruth,
      ...(groundTruth === "seller" && sellerUserId
        ? { matched_seller_id: sellerUserId }
        : {}),
    },
  ];
}

export class AcousticCorpusRecorder {
  private micChunks: Int16Array[] = [];
  private loopbackChunks: Int16Array[] = [];
  private startedAtMs = 0;
  private active = false;

  start(): void {
    this.micChunks = [];
    this.loopbackChunks = [];
    this.startedAtMs = Date.now();
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  getDurationMs(): number {
    if (!this.startedAtMs) return 0;
    return Math.max(0, Date.now() - this.startedAtMs);
  }

  onMicFrame(pcm: Int16Array): void {
    if (!this.active) return;
    this.micChunks.push(pcm.slice());
  }

  onLoopbackFrame(pcm: Int16Array): void {
    if (!this.active) return;
    this.loopbackChunks.push(pcm.slice());
  }

  buildSavePayload(
    manifest: Omit<AcousticCorpusManifest, "sample_rate" | "channels"> & {
      sample_rate?: number;
      channels?: number;
    },
  ): AcousticCorpusSaveInput {
    const durationMs = Math.max(0, Date.now() - this.startedAtMs);
    const labels =
      manifest.labels.length > 0
        ? manifest.labels
        : [
            {
              start_ms: 0,
              end_ms: durationMs,
              ground_truth: "unknown" as const,
            },
          ];

    return {
      manifest: {
        ...manifest,
        sample_rate: manifest.sample_rate ?? 16000,
        channels: manifest.channels ?? 1,
        labels,
      },
      micPcm: concatPcm16Chunks(this.micChunks),
      loopbackPcm: concatPcm16Chunks(this.loopbackChunks),
    };
  }
}
