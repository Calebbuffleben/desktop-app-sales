import type { AcousticClass } from "./fingerprint-types";

/** PCM v2 binary envelope for acoustic labels on the wire. */

export const PCM_V2_MAGIC = 0x4d503206; // "MP2\x06"
export const PCM_V2_HEADER_BYTES = 24;

export type AcousticWindowLabel = {
  labelId: number;
  acousticClass: AcousticClass;
  matchedSellerId?: string;
  confidence: number;
  lagMs: number;
  windowStartMs: number;
  windowEndMs: number;
};

export type PcmV2Frame = {
  frameSeq: number;
  captureMonoMs: number;
  labelId: number;
  pcm: Int16Array;
};

const CLASS_TO_CODE: Record<AcousticClass, number> = {
  unknown: 0,
  customer: 1,
  seller: 2,
};

const CODE_TO_CLASS: AcousticClass[] = ["unknown", "customer", "seller"];

export function encodePcmV2Frame(frame: PcmV2Frame): ArrayBuffer {
  const pcmBytes = frame.pcm.byteLength;
  const buffer = new ArrayBuffer(PCM_V2_HEADER_BYTES + pcmBytes);
  const view = new DataView(buffer);
  view.setUint32(0, PCM_V2_MAGIC, false);
  view.setUint32(4, frame.frameSeq >>> 0, false);
  view.setUint32(8, frame.captureMonoMs >>> 0, false);
  view.setUint32(12, frame.labelId >>> 0, false);
  view.setUint32(16, pcmBytes >>> 0, false);
  view.setUint32(20, 0, false); // reserved
  new Uint8Array(buffer, PCM_V2_HEADER_BYTES).set(
    new Uint8Array(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength),
  );
  return buffer;
}

export function tryDecodePcmV2Frame(
  data: ArrayBuffer | Uint8Array,
): PcmV2Frame | null {
  const bytes =
    data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < PCM_V2_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== PCM_V2_MAGIC) return null;
  const frameSeq = view.getUint32(4, false);
  const captureMonoMs = view.getUint32(8, false);
  const labelId = view.getUint32(12, false);
  const pcmLength = view.getUint32(16, false);
  if (bytes.byteLength < PCM_V2_HEADER_BYTES + pcmLength) return null;
  const pcmSlice = bytes.subarray(
    PCM_V2_HEADER_BYTES,
    PCM_V2_HEADER_BYTES + pcmLength,
  );
  const pcm = new Int16Array(
    pcmSlice.buffer,
    pcmSlice.byteOffset,
    pcmSlice.byteLength / 2,
  );
  return { frameSeq, captureMonoMs, labelId, pcm };
}

export function isPcmV2(data: ArrayBuffer | Uint8Array): boolean {
  const bytes =
    data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, false) === PCM_V2_MAGIC;
}

/** Control frame (JSON) declaring the current acoustic label for labelId. */
export function encodeLabelControl(label: AcousticWindowLabel): string {
  return JSON.stringify({
    type: "acoustic_label",
    labelId: label.labelId,
    acousticClass: label.acousticClass,
    matchedSellerId: label.matchedSellerId ?? null,
    confidence: label.confidence,
    lagMs: label.lagMs,
    windowStartMs: label.windowStartMs,
    windowEndMs: label.windowEndMs,
    classCode: CLASS_TO_CODE[label.acousticClass],
  });
}

export function parseLabelControl(
  text: string,
): AcousticWindowLabel | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj.type !== "acoustic_label") return null;
    const code = Number(obj.classCode ?? 0);
    const acousticClass =
      (obj.acousticClass as AcousticClass | undefined) ??
      CODE_TO_CLASS[code] ??
      "unknown";
    return {
      labelId: Number(obj.labelId ?? 0),
      acousticClass,
      matchedSellerId: obj.matchedSellerId
        ? String(obj.matchedSellerId)
        : undefined,
      confidence: Number(obj.confidence ?? 0),
      lagMs: Number(obj.lagMs ?? 0),
      windowStartMs: Number(obj.windowStartMs ?? 0),
      windowEndMs: Number(obj.windowEndMs ?? 0),
    };
  } catch {
    return null;
  }
}

/** Aggregate labels overlapping [startMs, endMs] into a turn-level class. */
export function aggregateTurnAcousticClass(
  labels: AcousticWindowLabel[],
  startMs: number,
  endMs: number,
): AcousticClass {
  let sellerScore = 0;
  let customerScore = 0;
  let total = 0;
  for (const label of labels) {
    const overlap =
      Math.min(endMs, label.windowEndMs) - Math.max(startMs, label.windowStartMs);
    if (overlap <= 0) continue;
    const weight = overlap * Math.max(0.1, label.confidence);
    total += weight;
    if (label.acousticClass === "seller") sellerScore += weight;
    else if (label.acousticClass === "customer") customerScore += weight;
  }
  if (total <= 0) return "unknown";
  const s = sellerScore / total;
  const c = customerScore / total;
  if (s >= 0.65 && s - c >= 0.15) return "seller";
  if (c >= 0.75 && s <= 0.2) return "customer";
  return "unknown";
}
