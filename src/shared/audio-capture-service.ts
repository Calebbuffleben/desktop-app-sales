import { buildEgressAudioWsUrl } from "./egress-audio-protocol";
import type { DesktopConfig } from "./desktop-config";

const FRAME_MS = 20;
const TARGET_SAMPLE_RATE = 16000;

export type AudioSourceMode = "auto" | "microphone" | "system";

export type CapturePlatform = "macos" | "windows" | "linux" | "unknown";

export type StartCaptureInput = {
  config: DesktopConfig;
  meetUrl?: string;
  meetingId?: string;
  participant?: string;
  track?: string;
  sourceMode: AudioSourceMode;
  debug?: boolean;
};

export type CaptureStatus = "idle" | "capturing";
export type AudioWsState = {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  wsUrl?: string;
  reconnectAttempt: number;
  nextRetryInMs?: number;
  lastError?: string;
};

function detectPlatform(): CapturePlatform {
  if (typeof navigator === "undefined") return "unknown";
  const raw = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (raw.includes("mac")) return "macos";
  if (raw.includes("win")) return "windows";
  if (raw.includes("linux")) return "linux";
  return "unknown";
}

function pcmFloatToInt16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function resampleFloat32(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  let outOffset = 0;
  let inOffset = 0;

  while (outOffset < outLen) {
    const nextInOffset = Math.round((outOffset + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = inOffset; i < nextInOffset && i < input.length; i += 1) {
      sum += input[i];
      count += 1;
    }
    out[outOffset] = count > 0 ? sum / count : 0;
    outOffset += 1;
    inOffset = nextInOffset;
  }
  return out;
}

function downmixToMono(inputBuffer: AudioBuffer): Float32Array {
  const channels = inputBuffer.numberOfChannels || 1;
  if (channels === 1) return inputBuffer.getChannelData(0).slice(0);

  const len = inputBuffer.length;
  const mono = new Float32Array(len);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = inputBuffer.getChannelData(channel);
    for (let i = 0; i < len; i += 1) mono[i] += data[i];
  }
  for (let i = 0; i < len; i += 1) mono[i] /= channels;
  return mono;
}

function matrixForMvp(platform: CapturePlatform): string {
  if (platform === "macos") {
    return "macOS MVP: prefer microphone; optional loopback with virtual device (BlackHole/Loopback).";
  }
  if (platform === "windows") {
    return "Windows MVP: prefer WASAPI loopback (system audio via getDisplayMedia), fallback to microphone.";
  }
  if (platform === "linux") {
    return "Linux MVP: prefer PulseAudio/PipeWire system capture via getDisplayMedia, fallback to microphone.";
  }
  return "Unknown platform: microphone fallback.";
}

export class DesktopAudioCaptureService {
  private status: CaptureStatus = "idle";
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;
  private audioContext: AudioContext | null = null;
  private queue = new Float32Array(0);
  private readonly onLog?: (message: string) => void;
  private readonly onState?: (state: AudioWsState) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private wsUrl = "";
  private debug = false;
  private connectingPromise: Promise<void> | null = null;
  private wsState: AudioWsState = {
    status: "idle",
    reconnectAttempt: 0,
  };

  constructor(
    onLog?: (message: string) => void,
    onState?: (state: AudioWsState) => void,
  ) {
    this.onLog = onLog;
    this.onState = onState;
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  private log(message: string): void {
    this.onLog?.(message);
  }

  private setWsState(next: Partial<AudioWsState>): void {
    this.wsState = { ...this.wsState, ...next };
    this.onState?.(this.wsState);
  }

  private connectWebSocket(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.setWsState({
        status: this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
        wsUrl: this.wsUrl,
        reconnectAttempt: this.reconnectAttempt,
        nextRetryInMs: undefined,
        lastError: undefined,
      });

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setWsState({
          status: "connected",
          reconnectAttempt: 0,
          nextRetryInMs: undefined,
          lastError: undefined,
        });
        this.connectingPromise = null;
        resolve();
      };

      ws.onerror = () => {
        const error = "Failed to connect egress websocket";
        this.setWsState({
          status: "error",
          lastError: error,
        });
        this.connectingPromise = null;
        reject(new Error(error));
      };

      ws.onclose = () => {
        if (this.status !== "capturing") return;
        const retryMs = Math.min(8000, 1000 * Math.max(1, this.reconnectAttempt + 1));
        this.reconnectAttempt += 1;
        this.setWsState({
          status: "reconnecting",
          reconnectAttempt: this.reconnectAttempt,
          nextRetryInMs: retryMs,
          lastError: "websocket closed",
        });
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          void this.connectWebSocket().catch((err) => {
            if (this.debug) this.log(`WS reconnect attempt failed: ${err.message}`);
          });
        }, retryMs);
      };
    });
    return this.connectingPromise;
  }

  private async openMicrophone(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  private async openSystemAudio(): Promise<MediaStream> {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((track) => track.stop());
      throw new Error("No system audio track available from getDisplayMedia");
    }

    const audioOnlyStream = new MediaStream(audioTracks);
    displayStream
      .getVideoTracks()
      .forEach((track) => track.stop());

    return audioOnlyStream;
  }

  private async resolveInputStream(
    sourceMode: AudioSourceMode,
  ): Promise<{ stream: MediaStream; resolvedSource: "microphone" | "system"; platform: CapturePlatform }> {
    const platform = detectPlatform();
    this.log(matrixForMvp(platform));

    if (sourceMode === "microphone") {
      const stream = await this.openMicrophone();
      return { stream, resolvedSource: "microphone", platform };
    }
    if (sourceMode === "system") {
      const stream = await this.openSystemAudio();
      return { stream, resolvedSource: "system", platform };
    }

    const preferSystem = platform === "windows" || platform === "linux";
    if (preferSystem) {
      try {
        const stream = await this.openSystemAudio();
        return { stream, resolvedSource: "system", platform };
      } catch (error) {
        this.log(
          `System audio capture unavailable, fallback to microphone: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const stream = await this.openMicrophone();
    return { stream, resolvedSource: "microphone", platform };
  }

  async start(input: StartCaptureInput): Promise<{ wsUrl: string; resolvedSource: "microphone" | "system"; platform: CapturePlatform }> {
    if (this.status === "capturing") {
      await this.stop();
    }

    const targetSampleRate = input.config.DEFAULT_SAMPLE_RATE || TARGET_SAMPLE_RATE;
    const channels = input.config.DEFAULT_CHANNELS || 1;

    this.debug = Boolean(input.debug);
    this.wsUrl = buildEgressAudioWsUrl({
      baseWs: input.config.BACKEND_WS_BASE,
      egressPath: input.config.EGRESS_AUDIO_PATH,
      meetUrl: input.meetUrl,
      meetingId: input.meetingId,
      participant: input.participant || "desktop",
      track: input.track || "desktop-audio",
      sampleRate: targetSampleRate,
      channels,
    });

    const { stream, resolvedSource, platform } = await this.resolveInputStream(input.sourceMode);
    this.mediaStream = stream;

    this.audioContext = new AudioContext({ sampleRate: targetSampleRate });
    await this.audioContext.resume();
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 2, 1);
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0;
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
    this.queue = new Float32Array(0);

    const frameSamples = Math.max(
      1,
      Math.round((targetSampleRate * FRAME_MS) / 1000),
    );

    await this.connectWebSocket();

    this.processorNode.onaudioprocess = (event) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const mono = downmixToMono(event.inputBuffer);
      const resampled = resampleFloat32(mono, this.audioContext?.sampleRate || targetSampleRate, targetSampleRate);

      if (this.queue.length === 0) {
        this.queue = new Float32Array(resampled);
      } else {
        const merged = new Float32Array(this.queue.length + resampled.length);
        merged.set(this.queue, 0);
        merged.set(resampled, this.queue.length);
        this.queue = merged;
      }

      let offset = 0;
      while (this.queue.length - offset >= frameSamples) {
        const frame = this.queue.subarray(offset, offset + frameSamples);
        const pcm = pcmFloatToInt16(frame);
        this.ws.send(pcm.buffer);
        offset += frameSamples;
      }
      if (offset > 0) this.queue = new Float32Array(this.queue.slice(offset));
    };

    this.status = "capturing";
    this.log(
      `Audio capture started | source=${resolvedSource} | platform=${platform} | ws=${this.wsUrl}`,
    );
    return { wsUrl: this.wsUrl, resolvedSource, platform };
  }

  async stop(): Promise<void> {
    this.status = "idle";
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.queue = new Float32Array(0);

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      try {
        this.processorNode.disconnect();
      } catch {}
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {}
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {}
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "desktop-capture-stop");
      } catch {}
    }

    this.ws = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.gainNode = null;
    this.audioContext = null;
    this.connectingPromise = null;
    this.reconnectAttempt = 0;
    this.wsUrl = "";
    this.setWsState({
      status: "idle",
      reconnectAttempt: 0,
      nextRetryInMs: undefined,
      lastError: undefined,
      wsUrl: undefined,
    });
    this.log("Audio capture stopped");
  }
}

