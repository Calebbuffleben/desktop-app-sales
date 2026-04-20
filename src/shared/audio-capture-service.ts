import { buildEgressAudioWsUrl } from "./egress-audio-protocol";
import type { DesktopConfig } from "./desktop-config";

const FRAME_MS = 20;
const TARGET_SAMPLE_RATE = 16000;
const MAX_FIRST_CONNECT_ATTEMPTS = 5;

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
  micGain?: number;
  loopbackGain?: number;
  /** Tenant id from the authenticated session. Sent as a redundant hint on
   * the WS URL; backend validates against `token.tid`. */
  tenantId: string;
  /** Provides a short-lived access token for the egress WebSocket. Called
   * every time the service (re)opens a connection so refreshed tokens take
   * effect without restarting capture. */
  getAccessToken: () => Promise<string | null>;
};

export type CaptureStatus = "idle" | "starting" | "capturing";
export type AudioWsState = {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  wsUrl?: string;
  reconnectAttempt: number;
  nextRetryInMs?: number;
  lastError?: string;
};

export type AudioMeter = {
  micRms: number;
  loopbackRms: number;
  mixedRms: number;
  bytesSent: number;
  framesSent: number;
  lastFrameTs: number;
};

type ResolvedSource = "microphone" | "system" | "mixed";

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

function rmsOfFloat32(buffer: Float32Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = buffer[i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

function matrixForMvp(platform: CapturePlatform): string {
  if (platform === "macos") {
    return "macOS: loopback nativo via ScreenCaptureKit (Electron 28+) quando possivel, mais microfone.";
  }
  if (platform === "windows") {
    return "Windows: loopback WASAPI via getDisplayMedia mais microfone.";
  }
  if (platform === "linux") {
    return "Linux: loopback PulseAudio/PipeWire via getDisplayMedia mais microfone.";
  }
  return "Plataforma desconhecida: apenas microfone.";
}

const PCM_WORKLET_SOURCE = `
class Pcm16FramerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const params = (options && options.processorOptions) || {};
    this.frameSamples = params.frameSamples || 320;
    this.buffer = new Float32Array(0);
    this.meterCounter = 0;
    this.meterAccum = 0;
    this.meterWindow = Math.max(1, Math.round(sampleRate * 0.05));
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    const merged = new Float32Array(this.buffer.length + channel.length);
    merged.set(this.buffer, 0);
    merged.set(channel, this.buffer.length);
    this.buffer = merged;

    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i];
      this.meterAccum += sample * sample;
      this.meterCounter += 1;
      if (this.meterCounter >= this.meterWindow) {
        const rms = Math.sqrt(this.meterAccum / this.meterCounter);
        this.port.postMessage({ type: "meter", rms });
        this.meterAccum = 0;
        this.meterCounter = 0;
      }
    }

    let offset = 0;
    while (this.buffer.length - offset >= this.frameSamples) {
      const frame = this.buffer.subarray(offset, offset + this.frameSamples);
      const pcm = new Int16Array(this.frameSamples);
      for (let i = 0; i < this.frameSamples; i += 1) {
        const c = Math.max(-1, Math.min(1, frame[i]));
        pcm[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
      }
      this.port.postMessage({ type: "frame", pcm: pcm.buffer }, [pcm.buffer]);
      offset += this.frameSamples;
    }
    if (offset > 0) this.buffer = this.buffer.slice(offset);
    return true;
  }
}

registerProcessor("pcm16-framer", Pcm16FramerProcessor);
`;

export class DesktopAudioCaptureService {
  private status: CaptureStatus = "idle";
  private ws: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private loopbackStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private loopbackSourceNode: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;
  private loopbackGainNode: GainNode | null = null;
  private mixerDestination: MediaStreamAudioDestinationNode | null = null;
  private mixedSourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private meterAnalyzers: {
    mic?: AnalyserNode;
    loopback?: AnalyserNode;
    mixed?: AnalyserNode;
  } = {};
  private meterIntervalId: ReturnType<typeof setInterval> | null = null;
  private micMeterBuffer: Float32Array | null = null;
  private loopbackMeterBuffer: Float32Array | null = null;
  private mixedMeterBuffer: Float32Array | null = null;
  private mixedRmsOverride: number | null = null;
  private silentSink: GainNode | null = null;
  private audioContext: AudioContext | null = null;
  private workletUrl: string | null = null;
  private queue = new Float32Array(0);
  private frameSamples = 320;
  private readonly onLog?: (message: string) => void;
  private readonly onState?: (state: AudioWsState) => void;
  private readonly onMeter?: (meter: AudioMeter) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private wsUrl = "";
  private debug = false;
  private baseWsParams: {
    baseWs: string;
    egressPath: string;
    meetUrl?: string;
    meetingId?: string;
    participant: string;
    track: string;
    sampleRate: number;
    channels: number;
    tenantId: string;
  } | null = null;
  private getAccessToken: (() => Promise<string | null>) | null = null;
  private connectingPromise: Promise<void> | null = null;
  private wsState: AudioWsState = {
    status: "idle",
    reconnectAttempt: 0,
  };
  private meter: AudioMeter = {
    micRms: 0,
    loopbackRms: 0,
    mixedRms: 0,
    bytesSent: 0,
    framesSent: 0,
    lastFrameTs: 0,
  };

  constructor(
    onLog?: (message: string) => void,
    onState?: (state: AudioWsState) => void,
    onMeter?: (meter: AudioMeter) => void,
  ) {
    this.onLog = onLog;
    this.onState = onState;
    this.onMeter = onMeter;
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

  private emitMeter(patch: Partial<AudioMeter>): void {
    this.meter = { ...this.meter, ...patch };
    this.onMeter?.(this.meter);
  }

  private async resolveWsUrl(): Promise<string> {
    if (!this.baseWsParams) {
      throw new Error("audio capture not configured");
    }
    const tokenProvider = this.getAccessToken;
    const token = tokenProvider ? await tokenProvider() : null;
    if (!token) {
      throw new Error("no access token available for egress websocket");
    }
    const url = buildEgressAudioWsUrl({
      ...this.baseWsParams,
      token,
    });
    this.wsUrl = url;
    return url;
  }

  private connectWebSocket(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    const promise = (async () => {
      try {
        const url = await this.resolveWsUrl();
        await this.openWebSocket(url);
      } catch (err) {
        this.connectingPromise = null;
        throw err;
      }
    })();
    this.connectingPromise = promise;
    return promise;
  }

  private openWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        this.connectingPromise = null;
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.setWsState({
        status: this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
        wsUrl: this.wsUrl,
        reconnectAttempt: this.reconnectAttempt,
        nextRetryInMs: undefined,
        lastError: undefined,
      });

      let settled = false;

      ws.onopen = () => {
        settled = true;
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

      ws.onerror = (event: Event) => {
        const description =
          event instanceof ErrorEvent && event.message
            ? event.message
            : "Failed to connect egress websocket";
        this.setWsState({
          status: "error",
          lastError: description,
        });
        if (!settled) {
          settled = true;
          this.connectingPromise = null;
          reject(new Error(description));
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (this.debug) {
          this.log(
            `WS closed | code=${event.code} | reason=${event.reason || "n/a"}`,
          );
        }
        if (this.status === "idle") return;
        this.scheduleReconnect("websocket closed");
      };
    });
  }

  private scheduleReconnect(reason: string): void {
    if (this.status === "idle") return;
    const attempt = this.reconnectAttempt + 1;
    const retryMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
    this.reconnectAttempt = attempt;
    this.setWsState({
      status: "reconnecting",
      reconnectAttempt: attempt,
      nextRetryInMs: retryMs,
      lastError: reason,
    });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectingPromise = null;
      void this.connectWebSocket().catch((err) => {
        if (this.debug) {
          this.log(
            `WS reconnect attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    }, retryMs);
  }

  private async connectWebSocketWithRetry(): Promise<void> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < MAX_FIRST_CONNECT_ATTEMPTS) {
      try {
        await this.connectWebSocket();
        return;
      } catch (err) {
        lastError = err;
        attempt += 1;
        this.reconnectAttempt = attempt;
        if (attempt >= MAX_FIRST_CONNECT_ATTEMPTS) break;
        const wait = Math.min(4000, 500 * Math.pow(2, attempt - 1));
        this.setWsState({
          status: "reconnecting",
          reconnectAttempt: attempt,
          nextRetryInMs: wait,
          lastError: err instanceof Error ? err.message : String(err),
        });
        this.log(
          `WS primeira conexao falhou (tentativa ${attempt}/${MAX_FIRST_CONNECT_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
        this.connectingPromise = null;
        if (this.status === "idle") throw new Error("capture aborted");
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("WebSocket connection failed after retries");
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
      throw new Error(
        "Nenhum track de audio retornado do getDisplayMedia. No macOS, confirme se a permissao de Gravacao de Tela esta concedida e se macOS>=13.",
      );
    }
    const audioOnlyStream = new MediaStream(audioTracks);
    displayStream.getVideoTracks().forEach((track) => track.stop());
    return audioOnlyStream;
  }

  private async ensureWorkletModule(ctx: AudioContext): Promise<void> {
    if (!ctx.audioWorklet) throw new Error("AudioWorklet indisponivel");
    if (!this.workletUrl) {
      const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" });
      this.workletUrl = URL.createObjectURL(blob);
    }
    await ctx.audioWorklet.addModule(this.workletUrl);
  }

  private attachMeters(ctx: AudioContext): void {
    const make = () => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      return analyser;
    };
    if (this.micGainNode) {
      const analyser = make();
      this.micGainNode.connect(analyser);
      this.meterAnalyzers.mic = analyser;
      this.micMeterBuffer = new Float32Array(analyser.fftSize);
    }
    if (this.loopbackGainNode) {
      const analyser = make();
      this.loopbackGainNode.connect(analyser);
      this.meterAnalyzers.loopback = analyser;
      this.loopbackMeterBuffer = new Float32Array(analyser.fftSize);
    }
    if (this.mixedSourceNode) {
      const analyser = make();
      this.mixedSourceNode.connect(analyser);
      this.meterAnalyzers.mixed = analyser;
      this.mixedMeterBuffer = new Float32Array(analyser.fftSize);
    }

    this.meterIntervalId = setInterval(() => {
      const micAnalyser = this.meterAnalyzers.mic;
      const loopAnalyser = this.meterAnalyzers.loopback;
      const mixAnalyser = this.meterAnalyzers.mixed;
      const patch: Partial<AudioMeter> = {};
      if (micAnalyser && this.micMeterBuffer) {
        micAnalyser.getFloatTimeDomainData(this.micMeterBuffer);
        patch.micRms = rmsOfFloat32(this.micMeterBuffer);
      }
      if (loopAnalyser && this.loopbackMeterBuffer) {
        loopAnalyser.getFloatTimeDomainData(this.loopbackMeterBuffer);
        patch.loopbackRms = rmsOfFloat32(this.loopbackMeterBuffer);
      }
      if (this.mixedRmsOverride !== null) {
        patch.mixedRms = this.mixedRmsOverride;
        this.mixedRmsOverride = null;
      } else if (mixAnalyser && this.mixedMeterBuffer) {
        mixAnalyser.getFloatTimeDomainData(this.mixedMeterBuffer);
        patch.mixedRms = rmsOfFloat32(this.mixedMeterBuffer);
      }
      if (Object.keys(patch).length > 0) this.emitMeter(patch);
    }, 200);
  }

  private sendFrame(pcm: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm.buffer);
    this.emitMeter({
      bytesSent: this.meter.bytesSent + pcm.byteLength,
      framesSent: this.meter.framesSent + 1,
      lastFrameTs: Date.now(),
    });
  }

  async start(
    input: StartCaptureInput,
  ): Promise<{ wsUrl: string; resolvedSource: ResolvedSource; platform: CapturePlatform }> {
    if (this.status !== "idle") {
      await this.stop();
    }

    const targetSampleRate = input.config.DEFAULT_SAMPLE_RATE || TARGET_SAMPLE_RATE;
    const channels = input.config.DEFAULT_CHANNELS || 1;

    if (!input.tenantId) {
      throw new Error("tenantId is required to start egress capture");
    }
    if (typeof input.getAccessToken !== "function") {
      throw new Error("getAccessToken is required to start egress capture");
    }

    this.debug = Boolean(input.debug);
    this.baseWsParams = {
      baseWs: input.config.BACKEND_WS_BASE,
      egressPath: input.config.EGRESS_AUDIO_PATH,
      meetUrl: input.meetUrl,
      meetingId: input.meetingId,
      participant: input.participant || "desktop",
      track: input.track || "desktop-audio",
      sampleRate: targetSampleRate,
      channels,
      tenantId: input.tenantId,
    };
    this.getAccessToken = input.getAccessToken;
    this.wsUrl = "";
    this.status = "starting";
    this.reconnectAttempt = 0;
    this.meter = {
      micRms: 0,
      loopbackRms: 0,
      mixedRms: 0,
      bytesSent: 0,
      framesSent: 0,
      lastFrameTs: 0,
    };
    this.emitMeter({});

    const platform = detectPlatform();
    this.log(matrixForMvp(platform));

    try {
      await this.connectWebSocketWithRetry();
    } catch (err) {
      this.status = "idle";
      this.setWsState({
        status: "error",
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    let resolvedSource: ResolvedSource = "microphone";
    try {
      const wantsMic =
        input.sourceMode === "auto" || input.sourceMode === "microphone";
      const wantsLoopback =
        input.sourceMode === "auto" || input.sourceMode === "system";

      if (wantsMic) {
        try {
          this.micStream = await this.openMicrophone();
        } catch (err) {
          if (input.sourceMode === "microphone") throw err;
          this.log(
            `Microfone indisponivel: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (wantsLoopback) {
        try {
          this.loopbackStream = await this.openSystemAudio();
        } catch (err) {
          if (input.sourceMode === "system") throw err;
          this.log(
            `Loopback indisponivel: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (!this.micStream && !this.loopbackStream) {
        throw new Error(
          "Nenhuma fonte de audio disponivel (mic e loopback falharam).",
        );
      }

      if (this.micStream && this.loopbackStream) resolvedSource = "mixed";
      else if (this.loopbackStream) resolvedSource = "system";
      else resolvedSource = "microphone";

      const ctx = new AudioContext({ sampleRate: targetSampleRate });
      this.audioContext = ctx;
      await ctx.resume();

      this.frameSamples = Math.max(
        1,
        Math.round((ctx.sampleRate * FRAME_MS) / 1000),
      );

      this.mixerDestination = ctx.createMediaStreamDestination();
      const micGainValue =
        typeof input.micGain === "number" && input.micGain >= 0
          ? input.micGain
          : 1.0;
      const loopbackGainValue =
        typeof input.loopbackGain === "number" && input.loopbackGain >= 0
          ? input.loopbackGain
          : 1.0;

      if (this.micStream) {
        this.micSourceNode = ctx.createMediaStreamSource(this.micStream);
        this.micGainNode = ctx.createGain();
        this.micGainNode.gain.value = micGainValue;
        this.micSourceNode.connect(this.micGainNode);
        this.micGainNode.connect(this.mixerDestination);
      }
      if (this.loopbackStream) {
        this.loopbackSourceNode = ctx.createMediaStreamSource(
          this.loopbackStream,
        );
        this.loopbackGainNode = ctx.createGain();
        this.loopbackGainNode.gain.value = loopbackGainValue;
        this.loopbackSourceNode.connect(this.loopbackGainNode);
        this.loopbackGainNode.connect(this.mixerDestination);
      }

      this.mixedSourceNode = ctx.createMediaStreamSource(
        this.mixerDestination.stream,
      );

      const allowWorklet =
        input.config.ALLOW_AUDIOWORKLET_FALLBACK !== false;
      const allowScriptProcessor =
        input.config.ALLOW_SCRIPT_PROCESSOR_FALLBACK !== false;

      let framerAttached = false;
      if (allowWorklet && typeof ctx.audioWorklet !== "undefined") {
        try {
          await this.ensureWorkletModule(ctx);
          this.workletNode = new AudioWorkletNode(ctx, "pcm16-framer", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { frameSamples: this.frameSamples },
          });
          this.workletNode.port.onmessage = (evt: MessageEvent) => {
            const payload = evt.data as
              | { type: "frame"; pcm: ArrayBuffer }
              | { type: "meter"; rms: number }
              | undefined;
            if (!payload) return;
            if (payload.type === "frame") {
              this.sendFrame(new Int16Array(payload.pcm));
            } else if (payload.type === "meter") {
              this.mixedRmsOverride = payload.rms;
            }
          };
          this.mixedSourceNode.connect(this.workletNode);
          this.silentSink = ctx.createGain();
          this.silentSink.gain.value = 0;
          this.workletNode.connect(this.silentSink);
          this.silentSink.connect(ctx.destination);
          framerAttached = true;
          this.log("PCM16 framer: AudioWorkletNode ativo");
        } catch (err) {
          this.log(
            `AudioWorklet indisponivel, tentando fallback: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (!framerAttached) {
        if (!allowScriptProcessor) {
          throw new Error(
            "AudioWorklet indisponivel e ScriptProcessor desabilitado via config.",
          );
        }
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        this.processorNode = processor;
        this.queue = new Float32Array(0);
        processor.onaudioprocess = (event) => {
          const channel = event.inputBuffer.getChannelData(0);
          if (!channel) return;
          const merged = new Float32Array(this.queue.length + channel.length);
          merged.set(this.queue, 0);
          merged.set(channel, this.queue.length);
          this.queue = merged;
          let offset = 0;
          while (this.queue.length - offset >= this.frameSamples) {
            const frame = this.queue.subarray(
              offset,
              offset + this.frameSamples,
            );
            this.sendFrame(pcmFloatToInt16(frame));
            offset += this.frameSamples;
          }
          if (offset > 0) this.queue = this.queue.slice(offset);
        };
        this.mixedSourceNode.connect(processor);
        this.silentSink = ctx.createGain();
        this.silentSink.gain.value = 0;
        processor.connect(this.silentSink);
        this.silentSink.connect(ctx.destination);
        this.log(
          "PCM16 framer: ScriptProcessorNode (fallback) ativo - AudioWorklet indisponivel",
        );
      }

      this.attachMeters(ctx);

      this.status = "capturing";
      this.log(
        `Audio capture started | source=${resolvedSource} | platform=${platform} | ws=${this.wsUrl}`,
      );
      return { wsUrl: this.wsUrl, resolvedSource, platform };
    } catch (err) {
      await this.teardown();
      this.status = "idle";
      throw err;
    }
  }

  private async teardown(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.meterIntervalId) {
      clearInterval(this.meterIntervalId);
      this.meterIntervalId = null;
    }

    const disconnectSafely = (node: { disconnect: () => void } | null) => {
      if (!node) return;
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    };

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      disconnectSafely(this.processorNode);
    }
    if (this.workletNode) {
      try {
        this.workletNode.port.onmessage = null;
      } catch {
        /* ignore */
      }
      disconnectSafely(this.workletNode);
    }
    disconnectSafely(this.mixedSourceNode);
    disconnectSafely(this.micSourceNode);
    disconnectSafely(this.loopbackSourceNode);
    disconnectSafely(this.micGainNode);
    disconnectSafely(this.loopbackGainNode);
    disconnectSafely(this.mixerDestination);
    disconnectSafely(this.silentSink);
    if (this.meterAnalyzers.mic) disconnectSafely(this.meterAnalyzers.mic);
    if (this.meterAnalyzers.loopback)
      disconnectSafely(this.meterAnalyzers.loopback);
    if (this.meterAnalyzers.mixed) disconnectSafely(this.meterAnalyzers.mixed);
    this.meterAnalyzers = {};

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
    }
    if (this.loopbackStream) {
      this.loopbackStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        /* ignore */
      }
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.onmessage = null;
      } catch {
        /* ignore */
      }
      try {
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close(1000, "desktop-capture-stop");
        }
      } catch {
        /* ignore */
      }
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }

    this.ws = null;
    this.micStream = null;
    this.loopbackStream = null;
    this.micSourceNode = null;
    this.loopbackSourceNode = null;
    this.micGainNode = null;
    this.loopbackGainNode = null;
    this.mixerDestination = null;
    this.mixedSourceNode = null;
    this.workletNode = null;
    this.processorNode = null;
    this.silentSink = null;
    this.audioContext = null;
    this.queue = new Float32Array(0);
    this.connectingPromise = null;
    this.reconnectAttempt = 0;
    this.wsUrl = "";
    this.baseWsParams = null;
    this.getAccessToken = null;
    this.setWsState({
      status: "idle",
      reconnectAttempt: 0,
      nextRetryInMs: undefined,
      lastError: undefined,
      wsUrl: undefined,
    });
  }

  async stop(): Promise<void> {
    this.status = "idle";
    await this.teardown();
    this.log("Audio capture stopped");
  }
}
