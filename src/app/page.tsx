"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  DesktopAudioCaptureService,
  type AudioMeter,
  type AudioSourceMode,
  type AudioWsState,
} from "@/shared/audio-capture-service";
import type { DesktopConfig } from "@/shared/desktop-config";
import type { CaptureReadiness, DisplaySource } from "@/types/desktop-api";
import {
  DesktopFeedbackClient,
  type FeedbackConnectionState,
} from "@/shared/feedback-client";

type CaptureErrorInfo = {
  stage: string;
  message: string;
  detail?: string;
  ts: number;
};

type CaptureStatus = "idle" | "capturing";
type UpdateUiState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  message: string;
  version: string;
  progress: number;
};
const FALLBACK_UPDATE_STATE = {
  status: "idle",
  message: "updater unavailable",
  version: "",
  progress: 0,
} satisfies UpdateUiState;

function VuBar({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  const pct = Math.min(100, Math.round(Math.sqrt(Math.max(0, value)) * 140));
  const barClass = highlight
    ? "h-1.5 rounded bg-gradient-to-r from-emerald-500 to-cyan-400"
    : "h-1.5 rounded bg-cyan-500/70";
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="h-1.5 flex-1 rounded bg-zinc-800">
        <div className={barClass} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-[10px] text-zinc-500">
        {value.toFixed(3)}
      </span>
    </div>
  );
}

function CopilotSection({
  moduleId,
  kicker,
  title,
  children,
  className = "",
}: {
  moduleId: string;
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-cyan-500/15 bg-zinc-900/35 p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.05),0_20px_50px_-18px_rgba(0,0,0,0.65)] backdrop-blur-sm ${className}`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-cyan-500/10 pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/90">
            {kicker}
          </p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-50">{title}</h2>
        </div>
        <span className="shrink-0 rounded border border-zinc-700/80 bg-zinc-950/80 px-2 py-0.5 font-mono text-[10px] tracking-wide text-zinc-500">
          {moduleId}
        </span>
      </header>
      {children}
    </section>
  );
}

export default function Home() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [isElectronRuntime, setIsElectronRuntime] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [clickThrough, setClickThrough] = useState(false);
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [meetUrl, setMeetUrl] = useState("https://meet.google.com/abc-defg-hij");
  const [meetingId, setMeetingId] = useState("");
  const [participant, setParticipant] = useState("browser");
  const [track, setTrack] = useState("tab-audio");
  const [sampleRate, setSampleRate] = useState(16000);
  const [channels, setChannels] = useState(1);
  const [previewWsUrl, setPreviewWsUrl] = useState("");
  const [validationResult, setValidationResult] = useState("");
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>("auto");
  const [captureDetails, setCaptureDetails] = useState("");
  const [feedbackBase, setFeedbackBase] = useState("http://localhost:3001");
  const [anchorMode, setAnchorMode] = useState<"fixed" | "meet-window">("fixed");
  const [debugLogs, setDebugLogs] = useState(false);
  const [forcePolling, setForcePolling] = useState(false);
  const [audioWsState, setAudioWsState] = useState<AudioWsState>({
    status: "idle",
    reconnectAttempt: 0,
  });
  const [feedbackState, setFeedbackState] = useState<FeedbackConnectionState>({
    socketStatus: "idle",
    pollingActive: false,
    forcePolling: false,
    reconnectAttempt: 0,
  });
  const [updateState, setUpdateState] = useState<UpdateUiState>({
    ...FALLBACK_UPDATE_STATE,
  });
  const [permissionPolicy, setPermissionPolicy] = useState<{
    platform: string;
    microphoneStatus: string;
    cameraStatus: string;
    isAccessibilityTrusted: boolean | null;
    notes: string[];
  } | null>(null);
  const [captureError, setCaptureError] = useState<CaptureErrorInfo | null>(null);
  const [readiness, setReadiness] = useState<CaptureReadiness | null>(null);
  const [displaySources, setDisplaySources] = useState<DisplaySource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [loadingSources, setLoadingSources] = useState(false);
  const [audioMeter, setAudioMeter] = useState<AudioMeter>({
    micRms: 0,
    loopbackRms: 0,
    mixedRms: 0,
    bytesSent: 0,
    framesSent: 0,
    lastFrameTs: 0,
  });
  const isBridgeAvailable = bridgeReady;

  const appendLog = useCallback((message: string) => {
    setLogs((prev) =>
      [`${new Date().toISOString()} ${message}`, ...prev].slice(0, 250),
    );
  }, []);

  const reportError = useCallback(
    (stage: string, err: unknown, detail?: string) => {
      const message = err instanceof Error ? err.message : String(err);
      const info: CaptureErrorInfo = {
        stage,
        message,
        detail,
        ts: Date.now(),
      };
      setCaptureError(info);
      appendLog(
        `ERROR [${stage}] ${message}${detail ? ` | ${detail}` : ""}`,
      );
      if (typeof window !== "undefined" && window.desktopApi?.reportCaptureError) {
        void window.desktopApi
          .reportCaptureError({ stage, message, detail })
          .catch(() => {});
      }
    },
    [appendLog],
  );

  const [captureService] = useState(
    () =>
      new DesktopAudioCaptureService(
        (message) => appendLog(message),
        (state) => setAudioWsState(state),
        (meter) => setAudioMeter(meter),
      ),
  );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setIsElectronRuntime(
        typeof navigator !== "undefined" && navigator.userAgent.includes("Electron"),
      );
      setBridgeReady(typeof window !== "undefined" && Boolean(window.desktopApi));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bridgeReady || typeof window === "undefined") return;
    const desktopApi = window.desktopApi;
    if (!desktopApi) return;

    void desktopApi
      .getState()
      .then((state) => {
        setCaptureStatus(state.captureStatus);
        setClickThrough(state.clickThrough);
        setConfig(state.config);
        setLogs(state.logs);
        setMeetingId(state.meetingId || "");
        setFeedbackBase(state.feedbackHttpBase || "http://localhost:3001");
        setAnchorMode(state.anchorMode);
        setSelectedSourceId(state.selectedSourceId || "");
        setUpdateState(
          state.update
            ? state.update
            : { ...FALLBACK_UPDATE_STATE, message: "updater not exposed by main process" },
        );
      })
      .catch((error) => {
        reportError("get-state", error);
      });
    const unsubscribeAnchor = desktopApi.onAnchorModeUpdated((payload) => {
      setAnchorMode(payload.anchorMode);
    });
    const unsubscribeUpdate =
      typeof desktopApi.onUpdateStatus === "function"
        ? desktopApi.onUpdateStatus((payload) => {
            if (!payload) return;
            setUpdateState(payload);
          })
        : () => {};
    const unsubscribeLogEntry =
      typeof desktopApi.onLogEntry === "function"
        ? desktopApi.onLogEntry((payload) => {
            if (!payload?.line) return;
            setLogs((prev) => [payload.line, ...prev].slice(0, 250));
          })
        : () => {};
    const unsubscribeSelectedSource =
      typeof desktopApi.onSelectedSourceUpdated === "function"
        ? desktopApi.onSelectedSourceUpdated((payload) => {
            setSelectedSourceId(payload?.sourceId || "");
          })
        : () => {};
    if (typeof desktopApi.getPermissionPolicy === "function") {
      void desktopApi
        .getPermissionPolicy()
        .then((result) => {
          setPermissionPolicy(result);
        })
        .catch((error) => {
          reportError("permission-policy", error);
          setPermissionPolicy(null);
        });
    }
    if (typeof desktopApi.checkCaptureReadiness === "function") {
      void desktopApi
        .checkCaptureReadiness()
        .then((result) => setReadiness(result))
        .catch((error) => reportError("check-readiness", error));
    }
    return () => {
      unsubscribeAnchor();
      unsubscribeUpdate();
      unsubscribeLogEntry();
      unsubscribeSelectedSource();
    };
  }, [bridgeReady, reportError]);

  useEffect(() => {
    return () => {
      void captureService.stop();
    };
  }, [captureService]);

  useEffect(() => {
    if (!isBridgeAvailable || !meetingId || !feedbackBase) return;
    const client = new DesktopFeedbackClient({
      meetingId,
      httpBase: feedbackBase,
      onFeedback: () => {},
      onStatus: (status) => {
        if (!debugLogs) return;
        setLogs((prev) => [`${new Date().toISOString()} ${status}`, ...prev].slice(0, 250));
      },
      onState: (state) => setFeedbackState(state),
      forcePolling,
      debug: debugLogs,
    });
    client.start();
    return () => {
      client.stop();
    };
  }, [isBridgeAvailable, meetingId, feedbackBase, forcePolling, debugLogs]);

  async function handleStartCapture(): Promise<void> {
    if (!window.desktopApi || !config) return;
    try {
      setCaptureError(null);
      const result = await captureService.start({
        config,
        meetUrl,
        meetingId: meetingId || undefined,
        participant,
        track,
        sourceMode,
        debug: debugLogs,
      });
      setCaptureStatus("capturing");
      setCaptureDetails(
        `source=${result.resolvedSource} | platform=${result.platform} | ws=${result.wsUrl}`,
      );
      await window.desktopApi.startCapture();
    } catch (error) {
      reportError("start-capture", error);
      setCaptureStatus("idle");
      setCaptureDetails("");
      try {
        await captureService.stop();
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  async function handleStopCapture(): Promise<void> {
    if (!window.desktopApi) return;
    try {
      await captureService.stop();
      setCaptureStatus("idle");
      setCaptureDetails("");
      await window.desktopApi.stopCapture();
      const state = await window.desktopApi.getState();
      setLogs((prev) => [...prev, ...state.logs].slice(0, 250));
    } catch (error) {
      reportError("stop-capture", error);
    }
  }

  async function handleToggleClickThrough(): Promise<void> {
    if (!window.desktopApi) return;
    try {
      const result = await window.desktopApi.setClickThrough(!clickThrough);
      setClickThrough(result.clickThrough);
      const state = await window.desktopApi.getState();
      setLogs(state.logs);
    } catch (error) {
      reportError("toggle-click-through", error);
    }
  }

  async function handleRequestPermission(
    kind: "microphone" | "screen" | "accessibility",
  ): Promise<void> {
    if (!window.desktopApi || typeof window.desktopApi.requestPermission !== "function") return;
    try {
      const result = await window.desktopApi.requestPermission(kind);
      appendLog(`permission:${kind} => ${JSON.stringify(result)}`);
      if (typeof window.desktopApi.getPermissionPolicy === "function") {
        const policy = await window.desktopApi.getPermissionPolicy();
        setPermissionPolicy(policy);
      }
      if (typeof window.desktopApi.checkCaptureReadiness === "function") {
        const nextReadiness = await window.desktopApi.checkCaptureReadiness();
        setReadiness(nextReadiness);
      }
    } catch (error) {
      reportError(`request-permission:${kind}`, error);
    }
  }

  async function handleRefreshReadiness(): Promise<void> {
    if (!window.desktopApi?.checkCaptureReadiness) return;
    try {
      const next = await window.desktopApi.checkCaptureReadiness();
      setReadiness(next);
    } catch (error) {
      reportError("refresh-readiness", error);
    }
  }

  async function handleLoadDisplaySources(): Promise<void> {
    if (!window.desktopApi?.listDisplaySources) return;
    setLoadingSources(true);
    try {
      const sources = await window.desktopApi.listDisplaySources();
      setDisplaySources(sources);
      if (!selectedSourceId && sources.length > 0) {
        const preferred = sources.find((s) => s.isMeet) || sources[0];
        if (preferred) {
          await window.desktopApi.setSelectedSource(preferred.id);
          setSelectedSourceId(preferred.id);
        }
      }
    } catch (error) {
      reportError("list-display-sources", error);
    } finally {
      setLoadingSources(false);
    }
  }

  async function handlePickSource(sourceId: string): Promise<void> {
    if (!window.desktopApi?.setSelectedSource) return;
    try {
      await window.desktopApi.setSelectedSource(sourceId);
      setSelectedSourceId(sourceId);
    } catch (error) {
      reportError("set-selected-source", error);
    }
  }

  async function handleCheckUpdates(): Promise<void> {
    if (!window.desktopApi || typeof window.desktopApi.checkForUpdates !== "function") return;
    await window.desktopApi.checkForUpdates();
  }

  async function handleDownloadUpdate(): Promise<void> {
    if (!window.desktopApi || typeof window.desktopApi.downloadUpdate !== "function") return;
    await window.desktopApi.downloadUpdate();
  }

  async function handleInstallUpdateNow(): Promise<void> {
    if (!window.desktopApi || typeof window.desktopApi.installUpdateNow !== "function") return;
    await window.desktopApi.installUpdateNow();
  }

  function formatMs(value?: number): string {
    return typeof value === "number" ? `${Math.round(value)}ms` : "n/a";
  }

  async function handleProtocolPreview(): Promise<void> {
    if (!window.desktopApi) return;
    try {
      const result = await window.desktopApi.protocolPreview({
        meetUrl,
        meetingId: meetingId || undefined,
        participant,
        track,
        sampleRate,
        channels,
      });
      setPreviewWsUrl(result.wsUrl);
      setFeedbackBase(result.httpBase);
    } catch (error) {
      reportError("protocol-preview", error);
    }
  }

  async function handleProtocolValidate(): Promise<void> {
    if (!window.desktopApi) return;
    try {
      const result = await window.desktopApi.protocolValidate({
        meetUrl,
        meetingId: meetingId || undefined,
        participant,
        track,
        sampleRate,
        channels,
      });
      setPreviewWsUrl(result.wsUrl);
      setValidationResult(
        result.ok
          ? `ok | handshake=${String(result.handshake)} | bytes=${result.payloadSentBytes} | close=${result.closedCode ?? "n/a"}`
          : `falha | handshake=${String(result.handshake)} | erro=${result.error ?? "desconhecido"}`,
      );
      const state = await window.desktopApi.getState();
      setLogs(state.logs);
    } catch (error) {
      reportError("protocol-validate", error);
      setValidationResult(
        `falha | erro=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function handleSyncFeedbackContext(): Promise<void> {
    if (!window.desktopApi) return;
    try {
      const result = await window.desktopApi.setFeedbackContext({
        meetingId: meetingId || undefined,
        feedbackHttpBase: feedbackBase,
      });
      setMeetingId(result.meetingId);
      setFeedbackBase(result.feedbackHttpBase);
      const state = await window.desktopApi.getState();
      setAnchorMode(state.anchorMode);
      setLogs(state.logs);
    } catch (error) {
      reportError("sync-feedback-context", error);
    }
  }

  const field =
    "mt-1.5 w-full rounded-lg border border-zinc-700/90 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/35";
  const subbox =
    "rounded-lg border border-zinc-800/90 bg-zinc-950/50 p-3 text-xs text-zinc-400";
  const btn =
    "rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-cyan-500/35 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45";
  const btnPrimary =
    "rounded-lg border border-cyan-500/45 bg-cyan-600/95 px-3 py-2 text-xs font-medium text-white shadow-[0_0_22px_-8px_rgba(34,211,238,0.5)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45";
  const btnDanger =
    "rounded-lg border border-rose-500/40 bg-rose-600/95 px-3 py-2 text-xs font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-45";
  const labelCls = "block text-xs font-medium text-zinc-500";
  const pill =
    "inline-flex items-center rounded-full border border-cyan-500/15 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300";

  return (
    <div className="relative min-h-screen text-zinc-100">
      <div className="copilot-bg" aria-hidden />
      <div className="copilot-vignette" aria-hidden />
      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 md:px-8">
        <header className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-zinc-900/85 via-zinc-950/90 to-[#05080f] p-6 shadow-[0_0_48px_-16px_rgba(34,211,238,0.18)] md:p-8">
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/12 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400/95">
                Copiloto de vendas
              </p>
              <h1 className="mt-3 max-w-xl bg-gradient-to-r from-cyan-100 via-zinc-100 to-violet-200 bg-clip-text text-3xl font-semibold tracking-tight text-transparent md:text-4xl">
                Meet Copilot
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Leitura da conversa, SPIN e feedback ao vivo enquanto você conduz a demo ou negociação — menos
                ruído, mais próximo do fechamento.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/50 px-3 py-1.5 font-mono text-[11px] text-cyan-100/95">
                <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
                Pronto para insight em tempo real
              </span>
              <p className="text-left text-[11px] text-zinc-500 md:text-right">Google Meet · áudio · overlay</p>
            </div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <CopilotSection moduleId="M01" kicker="Operação" title="Captura & sessão">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={pill}>
                Captura:{" "}
                <strong className={captureStatus === "capturing" ? "text-cyan-300" : "text-zinc-200"}>
                  {captureStatus}
                </strong>
              </span>
              <span className={pill}>Bridge: {isBridgeAvailable ? "ok" : "indisponivel"}</span>
              <span className={pill}>Anchor: {anchorMode === "meet-window" ? "meet-window" : "fixed"}</span>
              <span className={pill}>Meet: {anchorMode === "meet-window" ? "detectada" : "—"}</span>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className={labelCls}>
                Fonte de captura (MVP cross-platform)
                <select
                  className={field}
                  value={sourceMode}
                  onChange={(e) => setSourceMode(e.target.value as AudioSourceMode)}
                >
                  <option value="auto">auto (matriz por SO)</option>
                  <option value="microphone">microphone</option>
                  <option value="system">system / loopback</option>
                </select>
              </label>
              <div className={subbox}>
                <p>macOS: microfone primeiro, loopback opcional via device virtual.</p>
                <p>Windows: loopback/WASAPI quando disponível, fallback microfone.</p>
                <p>Linux: PulseAudio/PipeWire quando disponível, fallback microfone.</p>
              </div>
              <label className={`${labelCls} md:col-span-2`}>
                Runtime flags
                <div className={`${subbox} mt-2 space-y-2`}>
                  <label className="flex items-center gap-2 text-zinc-300">
                    <input
                      className="rounded border-zinc-600 text-cyan-500 focus:ring-cyan-500"
                      type="checkbox"
                      checked={debugLogs}
                      onChange={(e) => setDebugLogs(e.target.checked)}
                    />
                    debug logs detalhados
                  </label>
                  <label className="flex items-center gap-2 text-zinc-300">
                    <input
                      className="rounded border-zinc-600 text-cyan-500 focus:ring-cyan-500"
                      type="checkbox"
                      checked={forcePolling}
                      onChange={(e) => setForcePolling(e.target.checked)}
                    />
                    modo polling forçado (feedback)
                  </label>
                </div>
              </label>
            </div>

            {captureError ? (
              <div className="mb-3 rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-rose-300">
                    Erro [{captureError.stage}]
                  </p>
                  <button
                    type="button"
                    onClick={() => setCaptureError(null)}
                    className="font-mono text-[10px] text-rose-300 hover:text-rose-100"
                  >
                    dispensar
                  </button>
                </div>
                <p className="mt-1 font-mono text-[11px] text-rose-100">
                  {captureError.message}
                </p>
                {captureError.detail ? (
                  <p className="mt-1 font-mono text-[10px] text-rose-200/80">
                    {captureError.detail}
                  </p>
                ) : null}
              </div>
            ) : null}

            {readiness && !readiness.ok ? (
              <div className="mb-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <p className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
                  Requisitos de captura
                </p>
                <ul className="mt-1 list-disc pl-4 font-mono text-[11px]">
                  {readiness.missing.includes("macos-version") ? (
                    <li>
                      macOS {readiness.macosVersion || "?"} detectado. Loopback nativo precisa macOS 13+.
                    </li>
                  ) : null}
                  {readiness.missing.includes("microphone") ? (
                    <li>
                      Permissão de microfone: {readiness.microphoneStatus}.{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void handleRequestPermission("microphone")}
                      >
                        solicitar
                      </button>
                    </li>
                  ) : null}
                  {readiness.missing.includes("screen") ? (
                    <li>
                      Permissão de gravação de tela: {readiness.screenStatus}.{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void handleRequestPermission("screen")}
                      >
                        abrir preferências
                      </button>
                    </li>
                  ) : null}
                </ul>
                <button
                  type="button"
                  className="mt-2 rounded border border-amber-400/40 px-2 py-0.5 font-mono text-[10px] text-amber-100 hover:bg-amber-400/10"
                  onClick={() => void handleRefreshReadiness()}
                >
                  reverificar
                </button>
              </div>
            ) : null}

            <div className="mb-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-500/90">
                  Fonte de loopback (janela do Meet)
                </p>
                <button
                  type="button"
                  className={`${btn} !px-2 !py-0.5 text-[11px]`}
                  onClick={() => void handleLoadDisplaySources()}
                  disabled={!isBridgeAvailable || loadingSources}
                >
                  {loadingSources ? "carregando..." : "listar fontes"}
                </button>
              </div>
              {displaySources.length === 0 ? (
                <p className="mt-2 font-mono text-[11px] text-zinc-500">
                  Nenhuma fonte carregada. Clique em &quot;listar fontes&quot; para escolher a janela do Meet.
                </p>
              ) : (
                <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {displaySources.map((source) => {
                    const active = source.id === selectedSourceId;
                    return (
                      <button
                        type="button"
                        key={source.id}
                        onClick={() => void handlePickSource(source.id)}
                        className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                          active
                            ? "border-cyan-500/70 bg-cyan-500/10"
                            : "border-zinc-800 bg-zinc-950/60 hover:border-cyan-500/40"
                        }`}
                      >
                        {source.thumbnailDataUrl ? (
                          <img
                            src={source.thumbnailDataUrl}
                            alt={source.name}
                            className="h-10 w-16 flex-none rounded border border-zinc-800 object-cover"
                          />
                        ) : (
                          <div className="h-10 w-16 flex-none rounded border border-zinc-800 bg-zinc-900" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11px] text-zinc-200">
                            {source.name || source.id}
                          </p>
                          <p className="font-mono text-[10px] text-zinc-500">
                            {source.kind}
                            {source.isMeet ? " · meet" : ""}
                            {source.isChrome ? " · chrome" : ""}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className={btnPrimary}
                onClick={handleStartCapture}
                disabled={!isBridgeAvailable || captureStatus === "capturing"}
                type="button"
              >
                Start capture
              </button>
              <button
                className={btnDanger}
                onClick={handleStopCapture}
                disabled={!isBridgeAvailable || captureStatus === "idle"}
                type="button"
              >
                Stop capture
              </button>
              <button className={btn} onClick={handleToggleClickThrough} disabled={!isBridgeAvailable} type="button">
                Overlay click-through: {clickThrough ? "on" : "off"}
              </button>
            </div>
            {!isBridgeAvailable ? (
              <p className="mt-2 font-mono text-[11px] text-amber-300">
                {isElectronRuntime
                  ? "Bridge desktopApi indisponível dentro do Electron — o preload falhou ao carregar."
                  : "Bridge desktopApi indisponível — abra via Electron (não funciona em um navegador comum)."}
              </p>
            ) : null}
            {captureDetails ? <p className={`${subbox} mt-3 font-mono text-[11px] text-zinc-300`}>{captureDetails}</p> : null}
          </CopilotSection>

          <CopilotSection moduleId="M02" kicker="Telemetry" title="Conexões em tempo real">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className={subbox}>
                <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-500/90">WS egress-audio</p>
                <p className="mt-1 font-mono text-[11px] text-zinc-300">Status: {audioWsState.status}</p>
                <p className="font-mono text-[11px] text-zinc-400">Retry #{audioWsState.reconnectAttempt}</p>
                <p className="font-mono text-[11px] text-zinc-400">Próximo: {formatMs(audioWsState.nextRetryInMs)}</p>
                <p className="font-mono text-[11px] text-zinc-500">Erro: {audioWsState.lastError || "n/a"}</p>
                <div className="mt-3 space-y-1">
                  <VuBar label="mic" value={audioMeter.micRms} />
                  <VuBar label="loopback" value={audioMeter.loopbackRms} />
                  <VuBar label="mixed" value={audioMeter.mixedRms} highlight />
                </div>
                <p className="mt-2 font-mono text-[11px] text-zinc-400">
                  Frames: {audioMeter.framesSent} · Bytes: {audioMeter.bytesSent}
                </p>
                <p className="font-mono text-[11px] text-zinc-500">
                  Último frame: {audioMeter.lastFrameTs
                    ? `${Math.max(0, Date.now() - audioMeter.lastFrameTs)}ms atrás`
                    : "n/a"}
                </p>
                {captureStatus === "capturing" &&
                audioMeter.lastFrameTs > 0 &&
                audioMeter.mixedRms < 0.005 &&
                Date.now() - audioMeter.lastFrameTs < 5000 ? (
                  <p className="mt-2 font-mono text-[10px] text-amber-300">
                    Loopback silencioso: confirme que o Meet está tocando no alto-falante/headphone selecionado no macOS.
                  </p>
                ) : null}
              </div>
              <div className={subbox}>
                <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-500/90">Socket.IO feedback</p>
                <p className="mt-1 font-mono text-[11px] text-zinc-300">Socket: {feedbackState.socketStatus}</p>
                <p className="font-mono text-[11px] text-zinc-400">Polling: {feedbackState.pollingActive ? "sim" : "não"}</p>
                <p className="font-mono text-[11px] text-zinc-400">Force: {feedbackState.forcePolling ? "sim" : "não"}</p>
                <p className="font-mono text-[11px] text-zinc-400">Retry #{feedbackState.reconnectAttempt}</p>
                <p className="font-mono text-[11px] text-zinc-400">Próximo: {formatMs(feedbackState.nextReconnectInMs)}</p>
                <p className="font-mono text-[11px] text-zinc-400">Latência: {formatMs(feedbackState.lastLatencyMs)}</p>
                <p className="font-mono text-[11px] text-zinc-500">Erro: {feedbackState.lastError || "n/a"}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Insight ativo:{" "}
              {feedbackState.socketStatus !== "idle" || feedbackState.pollingActive ? "sim" : "não"}
            </p>
          </CopilotSection>
        </div>

        <CopilotSection moduleId="M03" kicker="Sistema" title="Permissões, updates & canal seguro">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className={subbox}>
              <p className="font-semibold text-zinc-200">Auto-update</p>
              <p>Status: {updateState.status}</p>
              <p>Mensagem: {updateState.message}</p>
              <p>Versão: {updateState.version || "n/a"}</p>
              <p>Progresso: {updateState.progress}%</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className={btn} onClick={handleCheckUpdates} disabled={!isBridgeAvailable} type="button">
                  Check updates
                </button>
                <button className={btn} onClick={handleDownloadUpdate} disabled={!isBridgeAvailable} type="button">
                  Download update
                </button>
                <button className={btn} onClick={handleInstallUpdateNow} disabled={!isBridgeAvailable} type="button">
                  Install now
                </button>
              </div>
            </div>
            <div className={subbox}>
              <p className="font-semibold text-zinc-200">Permissões ({permissionPolicy?.platform || "n/a"})</p>
              <p>Microfone: {permissionPolicy?.microphoneStatus || "n/a"}</p>
              <p>Câmera: {permissionPolicy?.cameraStatus || "n/a"}</p>
              <p>
                Acessibilidade:{" "}
                {permissionPolicy?.isAccessibilityTrusted === null
                  ? "n/a"
                  : permissionPolicy?.isAccessibilityTrusted
                    ? "trusted"
                    : "not-trusted"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className={btn}
                  onClick={() => void handleRequestPermission("microphone")}
                  disabled={!isBridgeAvailable}
                  type="button"
                >
                  Request microphone
                </button>
                <button
                  className={btn}
                  onClick={() => void handleRequestPermission("screen")}
                  disabled={!isBridgeAvailable}
                  type="button"
                >
                  Open screen settings
                </button>
                <button
                  className={btn}
                  onClick={() => void handleRequestPermission("accessibility")}
                  disabled={!isBridgeAvailable}
                  type="button"
                >
                  Accessibility trust
                </button>
              </div>
            </div>
          </div>
          {permissionPolicy?.notes?.length ? (
            <div className={`${subbox} mt-3 text-zinc-400`}>
              {permissionPolicy.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
        </CopilotSection>

        <CopilotSection moduleId="M04" kicker="Integração" title="Protocolo egress-audio & contexto">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className={labelCls}>
              Meet URL
              <input className={field} value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)} />
            </label>
            <label className={labelCls}>
              Meeting ID (opcional)
              <input className={field} value={meetingId} onChange={(e) => setMeetingId(e.target.value)} />
            </label>
            <label className={labelCls}>
              Feedback HTTP base
              <input className={field} value={feedbackBase} onChange={(e) => setFeedbackBase(e.target.value)} />
            </label>
            <label className={labelCls}>
              Participant
              <input className={field} value={participant} onChange={(e) => setParticipant(e.target.value)} />
            </label>
            <label className={labelCls}>
              Track
              <input className={field} value={track} onChange={(e) => setTrack(e.target.value)} />
            </label>
            <label className={labelCls}>
              Sample rate
              <input
                className={field}
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value) || 16000)}
                type="number"
              />
            </label>
            <label className={labelCls}>
              Channels
              <input
                className={field}
                value={channels}
                onChange={(e) => setChannels(Number(e.target.value) || 1)}
                type="number"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn} onClick={handleProtocolPreview} disabled={!isBridgeAvailable} type="button">
              Gerar URL compatível
            </button>
            <button className={btn} onClick={handleSyncFeedbackContext} disabled={!isBridgeAvailable} type="button">
              Sincronizar contexto feedback/overlay
            </button>
            <button className={btn} onClick={handleProtocolValidate} disabled={!isBridgeAvailable} type="button">
              Validar handshake + PCM
            </button>
          </div>
          <div className={`${subbox} mt-3 font-mono text-[11px] text-zinc-300`}>
            <p>
              <span className="text-cyan-500/90">WS URL</span>{" "}
              <span className="break-all text-zinc-200">{previewWsUrl || "ainda nao gerada"}</span>
            </p>
            <p className="mt-2">
              <span className="text-cyan-500/90">Resultado</span> {validationResult || "nenhuma validacao executada"}
            </p>
          </div>
        </CopilotSection>

        <div className="grid gap-5 lg:grid-cols-2">
          <CopilotSection moduleId="M05" kicker="Estado" title="Configuração">
            {config ? (
              <pre className={`${subbox} max-h-96 overflow-auto p-4 text-[11px] leading-5 text-zinc-300`}>
                {JSON.stringify(config, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-zinc-500">Aguardando leitura da config…</p>
            )}
          </CopilotSection>

          <CopilotSection moduleId="M06" kicker="Diagnóstico" title="Logs">
            <div className={`${subbox} max-h-96 overflow-auto p-4 font-mono text-[11px] leading-5 text-zinc-300`}>
              {logs.length === 0 ? (
                <p className="text-zinc-500">Sem logs ainda.</p>
              ) : (
                logs.map((line) => <p key={line}>{line}</p>)
              )}
            </div>
          </CopilotSection>
        </div>
      </main>
    </div>
  );
}
