import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import * as electron from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import updater from "electron-updater";
import { loadDesktopConfig } from "../src/shared/desktop-config.ts";
import {
  buildEgressAudioWsUrl,
  buildPcm16SilentFrame,
  getEgressDefaults,
  wsToHttpBase,
} from "../src/shared/egress-audio-protocol.ts";
import WebSocket from "ws";
import { DesktopAuthService, SessionSnapshot } from "./auth-service.ts";

const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  session,
  shell,
  systemPreferences,
} = electron;
const { autoUpdater } = updater;

type CaptureStatus = "idle" | "capturing";
type OverlayAnchorMode = "fixed" | "meet-window";
type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";
type PermissionKind = "microphone" | "screen" | "accessibility";
const initialConfig = loadDesktopConfig({ baseDir: app.getAppPath() });

const appState = {
  captureStatus: "idle" as CaptureStatus,
  clickThrough: false,
  logs: [] as string[],
  meetingId: "abc-defg-hij",
  feedbackHttpBase: wsToHttpBase(initialConfig.BACKEND_WS_BASE),
  anchorMode: "fixed" as OverlayAnchorMode,
  selectedSourceId: "" as string,
  update: {
    status: "idle" as UpdateStatus,
    message: "updater idle",
    version: app.getVersion(),
    progress: 0,
  },
};

let controlWindow: BrowserWindowType | null = null;
let overlayWindow: BrowserWindowType | null = null;
const authService = new DesktopAuthService();

function broadcastAuthSession(snapshot: SessionSnapshot): void {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send("auth:session-updated", snapshot);
  }
}

authService.on("session-updated", (snapshot: SessionSnapshot) => {
  broadcastAuthSession(snapshot);
  addLog(
    `Auth session updated | authenticated=${snapshot.isAuthenticated} | tenant=${snapshot.tenant?.slug || "n/a"}`,
  );
});
authService.on("persistence-error", (message: string) => {
  addLog(`Auth persistence warning | ${message}`);
});

function ensureStringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing field: ${field}`);
  }
  return value;
}

function sanitizeBackendBase(raw: unknown): string {
  const value = ensureStringField(raw, "backendHttpBase");
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("backendHttpBase must be http(s)");
    }
    return parsed.origin;
  } catch (err) {
    throw new Error(
      `invalid backendHttpBase: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const isDev = !app.isPackaged;
const devServerUrl = process.env.NEXT_DEV_SERVER_URL ?? "http://localhost:3210";
const execFileAsync = promisify(execFile);
let overlayAnchorTimer: NodeJS.Timeout | null = null;
let activeWinModule: null | (typeof import("active-win"))["activeWindow"] = null;

type WindowBounds = { x: number; y: number; width: number; height: number };

function isAllowedRendererUrl(target: string): boolean {
  if (isDev) return target.startsWith(devServerUrl);
  return target.startsWith("file://");
}

function addLog(message: string): void {
  const ts = Date.now();
  const line = `${new Date(ts).toISOString()} ${message}`;
  appState.logs = [line, ...appState.logs].slice(0, 250);
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send("desktop:logs", appState.logs);
    controlWindow.webContents.send("desktop:log-entry", { line, ts });
  }
}

function parseMacosMajor(release: string): number | undefined {
  const parts = release.split(".");
  const kernelMajor = Number(parts[0]);
  if (!Number.isFinite(kernelMajor)) return undefined;
  const macosMajor = kernelMajor - 9;
  return macosMajor > 0 ? macosMajor : undefined;
}

function broadcastUpdateState(): void {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  controlWindow.webContents.send("desktop:update-status", appState.update);
}

function setUpdateState(next: Partial<typeof appState.update>): void {
  appState.update = { ...appState.update, ...next };
  broadcastUpdateState();
}

function setOverlayClickThrough(value: boolean): void {
  appState.clickThrough = value;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(value, { forward: true });
  }
  addLog(`Overlay click-through ${value ? "enabled" : "disabled"}`);
}

function setOverlayAnchorMode(mode: OverlayAnchorMode): void {
  if (appState.anchorMode === mode) return;
  appState.anchorMode = mode;
  addLog(`Overlay anchor mode: ${mode}`);
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send("desktop:anchor-mode-updated", {
      anchorMode: appState.anchorMode,
    });
  }
}

/** Hide the overlay BrowserWindow when there is nothing to show — transparent windows still reserve a compositor layer. */
function setOverlayWindowVisible(visible: boolean): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (visible) {
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }
}

const OVERLAY_WIDTH = 380;
/** Tall enough for stacked tip toasts (see overlay/page.tsx). */
const OVERLAY_HEIGHT = 520;

function ensureOverlayPosition(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + workArea.width - OVERLAY_WIDTH - 24);
  const y = Math.round(workArea.y + 24);
  overlayWindow.setBounds({ x, y, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });
}

function positionOverlayFromAnchor(bounds: WindowBounds): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const x = Math.round(bounds.x + bounds.width - OVERLAY_WIDTH - 18);
  const y = Math.round(bounds.y + 18);
  overlayWindow.setBounds({ x, y, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });
}

async function getMeetBoundsFromMacChrome(): Promise<WindowBounds | null> {
  try {
    const script =
      'set frontUrl to ""\n' +
      'tell application "Google Chrome"\n' +
      "if not (exists front window) then return \"\"\n" +
      "set frontUrl to URL of active tab of front window\n" +
      "set wBounds to bounds of front window\n" +
      'return frontUrl & "|" & (item 1 of wBounds as string) & "," & (item 2 of wBounds as string) & "," & (item 3 of wBounds as string) & "," & (item 4 of wBounds as string)\n' +
      "end tell";
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    const line = stdout.trim();
    if (!line || !line.includes("|")) return null;
    const [urlPart, boundsPart] = line.split("|");
    if (!urlPart.includes("meet.google.com")) return null;
    const [x1, y1, x2, y2] = boundsPart.split(",").map((value) => Number(value.trim()));
    if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return null;
    return { x: x1, y: y1, width: Math.max(100, x2 - x1), height: Math.max(100, y2 - y1) };
  } catch {
    return null;
  }
}

async function getActiveWindowModule() {
  if (activeWinModule) return activeWinModule;
  try {
    const imported = await import("active-win");
    activeWinModule = imported.activeWindow;
  } catch {
    activeWinModule = null;
  }
  return activeWinModule;
}

async function getMeetBoundsFromActiveWindow(): Promise<WindowBounds | null> {
  const activeWin = await getActiveWindowModule();
  if (!activeWin) return null;
  try {
    const details = await activeWin({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
    if (!details) return null;
    const owner = (details.owner?.name || "").toLowerCase();
    const title = (details.title || "").toLowerCase();
    const isChrome =
      owner.includes("chrome") || owner.includes("chromium") || owner.includes("google");
    const isMeet = title.includes("meet") || title.includes("google meet");
    const bounds = details.bounds;
    if (!isChrome || !isMeet || !bounds) return null;
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
  } catch {
    return null;
  }
}

async function detectActiveMeetWindowBounds(): Promise<WindowBounds | null> {
  if (process.platform === "darwin") {
    const fromAppleScript = await getMeetBoundsFromMacChrome();
    if (fromAppleScript) return fromAppleScript;
    // On macOS we intentionally avoid loading active-win fallback to prevent
    // native prebuild warnings during normal runtime when Chrome context is absent.
    return null;
  }
  return getMeetBoundsFromActiveWindow();
}

function startOverlayAnchoring(): void {
  if (overlayAnchorTimer) return;
  overlayAnchorTimer = setInterval(() => {
    void (async () => {
      const meetBounds = await detectActiveMeetWindowBounds();
      if (meetBounds) {
        positionOverlayFromAnchor(meetBounds);
        setOverlayAnchorMode("meet-window");
        return;
      }
      ensureOverlayPosition();
      setOverlayAnchorMode("fixed");
    })();
  }, 1200);
}

async function createWindows(): Promise<void> {
  const preloadPath = path.join(app.getAppPath(), "electron/preload.cjs");

  controlWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 840,
    minHeight: 620,
    title: "Meet Desktop Control",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });

  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });

  const hardenWindow = (win: BrowserWindowType): void => {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, targetUrl) => {
      if (isAllowedRendererUrl(targetUrl)) return;
      event.preventDefault();
      addLog(`Blocked navigation to untrusted URL: ${targetUrl}`);
    });
  };
  hardenWindow(controlWindow);
  hardenWindow(overlayWindow);

  ensureOverlayPosition();
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setOverlayClickThrough(appState.clickThrough);

  const resolveExportedRoute = (route: string): string => {
    const baseOut = path.join(app.getAppPath(), "out");
    const normalized = route.replace(/^\/+/, "");
    const candidates = normalized
      ? [path.join(baseOut, `${normalized}.html`), path.join(baseOut, normalized, "index.html")]
      : [path.join(baseOut, "index.html")];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return `file://${candidate}`;
    }
    return `file://${candidates[0]}`;
  };

  const controlUrl = isDev ? `${devServerUrl}/` : resolveExportedRoute("/");
  const overlayUrl = isDev ? `${devServerUrl}/overlay` : resolveExportedRoute("/overlay");

  await controlWindow.loadURL(controlUrl);
  await overlayWindow.loadURL(overlayUrl);
  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow?.webContents.send("desktop:feedback-context-updated", {
      meetingId: appState.meetingId,
      feedbackHttpBase: appState.feedbackHttpBase,
    });
  });

  addLog("Desktop app started");
  startOverlayAnchoring();
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-state", () => {
    const cfg = loadDesktopConfig({ baseDir: app.getAppPath() });
    return {
      captureStatus: appState.captureStatus,
      clickThrough: appState.clickThrough,
      logs: appState.logs,
      config: cfg,
      meetingId: appState.meetingId,
      feedbackHttpBase: appState.feedbackHttpBase,
      anchorMode: appState.anchorMode,
      selectedSourceId: appState.selectedSourceId,
      update: appState.update,
    };
  });

  ipcMain.handle("desktop:check-capture-readiness", () => {
    const platform = process.platform;
    const microphoneStatus =
      typeof systemPreferences.getMediaAccessStatus === "function"
        ? systemPreferences.getMediaAccessStatus("microphone")
        : "unknown";
    const screenStatus =
      typeof systemPreferences.getMediaAccessStatus === "function"
        ? systemPreferences.getMediaAccessStatus("screen")
        : "unknown";
    const macosMajor =
      platform === "darwin" ? parseMacosMajor(os.release()) : undefined;
    const missing: Array<"macos-version" | "microphone" | "screen"> = [];
    const notes: string[] = [];
    if (platform === "darwin") {
      if (!macosMajor || macosMajor < 13) {
        missing.push("macos-version");
        notes.push(
          `macOS detectado: ${macosMajor ?? "?"}. Loopback nativo do Electron requer macOS 13+`,
        );
      }
    }
    if (microphoneStatus !== "granted") {
      missing.push("microphone");
      notes.push("Permissao de microfone necessaria para captura local.");
    }
    if (platform === "darwin" && screenStatus !== "granted") {
      missing.push("screen");
      notes.push(
        "Permissao de Gravacao de Tela necessaria para captura loopback do Meet.",
      );
    }
    return {
      ok: missing.length === 0,
      platform,
      macosVersion: platform === "darwin" ? os.release() : undefined,
      macosMajor,
      microphoneStatus,
      screenStatus,
      missing,
      notes,
    };
  });

  ipcMain.handle("desktop:list-display-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      const serialized = sources.map((source) => {
        const name = source.name || "";
        const lowered = name.toLowerCase();
        const isWindow = source.id.startsWith("window:");
        const appIcon =
          source.appIcon && typeof source.appIcon.toDataURL === "function"
            ? source.appIcon.toDataURL()
            : undefined;
        return {
          id: source.id,
          name,
          display_id: source.display_id,
          thumbnailDataUrl:
            source.thumbnail && typeof source.thumbnail.toDataURL === "function"
              ? source.thumbnail.toDataURL()
              : undefined,
          iconDataUrl: appIcon,
          appIconDataUrl: appIcon,
          isMeet:
            lowered.includes("meet") || lowered.includes("google meet"),
          isChrome:
            lowered.includes("chrome") ||
            lowered.includes("chromium") ||
            lowered.includes("brave") ||
            lowered.includes("arc"),
          kind: (isWindow ? "window" : "screen") as "window" | "screen",
        };
      });
      serialized.sort((a, b) => {
        if (a.isMeet && !b.isMeet) return -1;
        if (!a.isMeet && b.isMeet) return 1;
        if (a.isChrome && !b.isChrome) return -1;
        if (!a.isChrome && b.isChrome) return 1;
        return a.name.localeCompare(b.name);
      });
      addLog(`displayMedia: ${serialized.length} fontes listadas`);
      return serialized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`displayMedia list error: ${message}`);
      return [];
    }
  });

  ipcMain.handle(
    "desktop:set-selected-source",
    (_event, payload?: { sourceId?: string }) => {
      const nextId = typeof payload?.sourceId === "string" ? payload.sourceId : "";
      appState.selectedSourceId = nextId;
      addLog(`displayMedia: selecao manual sourceId=${nextId || "<auto>"}`);
      if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send("desktop:selected-source-updated", {
          sourceId: nextId,
        });
      }
      return { ok: true, sourceId: nextId };
    },
  );

  ipcMain.handle(
    "desktop:capture-error",
    (_event, payload?: { stage?: string; message?: string; detail?: string }) => {
      const stage = payload?.stage || "capture";
      const message = payload?.message || "erro desconhecido";
      const detail = payload?.detail ? ` | ${payload.detail}` : "";
      addLog(`renderer error [${stage}]: ${message}${detail}`);
      return { ok: true as const };
    },
  );

  ipcMain.handle("desktop:capture-start", () => {
    appState.captureStatus = "capturing";
    addLog("Capture started");
    return { ok: true, captureStatus: appState.captureStatus };
  });

  ipcMain.handle("desktop:capture-stop", () => {
    appState.captureStatus = "idle";
    addLog("Capture stopped");
    return { ok: true, captureStatus: appState.captureStatus };
  });

  ipcMain.handle(
    "desktop:set-click-through",
    (_event, payload?: { enabled?: boolean } | boolean) => {
      const enabled =
        typeof payload === "boolean" ? payload : Boolean(payload?.enabled);
      setOverlayClickThrough(Boolean(enabled));
      return { ok: true, clickThrough: appState.clickThrough };
    },
  );

  ipcMain.handle(
    "desktop:set-overlay-window-visible",
    (_event, payload?: { visible?: boolean }) => {
      const visible = Boolean(payload?.visible);
      setOverlayWindowVisible(visible);
      return { ok: true as const, visible };
    },
  );

  ipcMain.handle("desktop:get-permission-policy", async () => {
    const platform = process.platform;
    const microphoneStatus =
      typeof systemPreferences.getMediaAccessStatus === "function"
        ? systemPreferences.getMediaAccessStatus("microphone")
        : "unknown";
    const cameraStatus =
      typeof systemPreferences.getMediaAccessStatus === "function"
        ? systemPreferences.getMediaAccessStatus("camera")
        : "unknown";
    const isAccessibilityTrusted =
      platform === "darwin"
        ? Boolean(systemPreferences.isTrustedAccessibilityClient(false))
        : null;
    return {
      platform,
      microphoneStatus,
      cameraStatus,
      isAccessibilityTrusted,
      notes: [
        "macOS: microphone permission required for getUserMedia capture.",
        "macOS: Accessibility may be required for active-window tracking fallback.",
        "Windows: microphone privacy permission should be enabled in OS settings.",
        "Linux: verify PipeWire/PulseAudio permissions for screen/system audio capture.",
      ],
    };
  });

  ipcMain.handle(
    "desktop:request-permission",
    async (_event, payload?: { kind?: PermissionKind }) => {
      const kind = payload?.kind;
      if (kind !== "microphone" && kind !== "screen" && kind !== "accessibility") {
        return { ok: false, error: "invalid-permission-kind" };
      }
      if (kind === "microphone" && process.platform === "darwin") {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        addLog(`Permission request microphone => ${granted ? "granted" : "denied"}`);
        return { ok: true, kind, granted };
      }
      if (kind === "accessibility" && process.platform === "darwin") {
        const trusted = Boolean(systemPreferences.isTrustedAccessibilityClient(true));
        if (!trusted) {
          await shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          );
        }
        addLog(`Accessibility trust => ${trusted ? "trusted" : "not-trusted"}`);
        return { ok: true, kind, granted: trusted };
      }
      if (kind === "screen" && process.platform === "darwin") {
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
        addLog("Opened macOS Screen Recording settings");
        return { ok: true, kind, granted: null };
      }
      addLog(`Permission request (${kind}) delegated to OS/browser prompt`);
      return { ok: true, kind, granted: null };
    },
  );

  ipcMain.handle("desktop:update-check", async () => {
    if (isDev) {
      return { ok: true, skipped: true, reason: "dev-mode" };
    }
    setUpdateState({ status: "checking", message: "checking for updates..." });
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, skipped: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateState({ status: "error", message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("desktop:update-download", async () => {
    if (isDev) return { ok: true, skipped: true, reason: "dev-mode" };
    try {
      setUpdateState({ status: "downloading", message: "downloading update..." });
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateState({ status: "error", message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("desktop:update-install", () => {
    if (isDev) return { ok: true, skipped: true, reason: "dev-mode" };
    setUpdateState({ status: "downloaded", message: "installing update..." });
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  });

  ipcMain.handle(
    "desktop:set-feedback-context",
    (_event, payload?: { meetingId?: string; feedbackHttpBase?: string }) => {
      const nextMeetingId =
        typeof payload?.meetingId === "string" && payload.meetingId.trim()
          ? payload.meetingId.trim()
          : appState.meetingId;
      const nextHttpBase =
        typeof payload?.feedbackHttpBase === "string" && payload.feedbackHttpBase.trim()
          ? payload.feedbackHttpBase.trim()
          : appState.feedbackHttpBase;

      appState.meetingId = nextMeetingId;
      appState.feedbackHttpBase = nextHttpBase;

      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("desktop:feedback-context-updated", {
          meetingId: appState.meetingId,
          feedbackHttpBase: appState.feedbackHttpBase,
        });
      }
      addLog(
        `Feedback context updated | meetingId=${appState.meetingId} | base=${appState.feedbackHttpBase}`,
      );
      return {
        ok: true,
        meetingId: appState.meetingId,
        feedbackHttpBase: appState.feedbackHttpBase,
      };
    },
  );

  ipcMain.handle("desktop:protocol-preview", (_event, payload?: Record<string, unknown>) => {
    const cfg = loadDesktopConfig();
    const defaults = getEgressDefaults(cfg);
    const meetUrl =
      typeof payload?.meetUrl === "string"
        ? payload.meetUrl
        : "https://meet.google.com/abc-defg-hij";
    const meetingId = typeof payload?.meetingId === "string" ? payload.meetingId : undefined;
    const participant =
      typeof payload?.participant === "string" ? payload.participant : defaults.participant;
    const track = typeof payload?.track === "string" ? payload.track : defaults.track;
    const sampleRate =
      typeof payload?.sampleRate === "number" ? payload.sampleRate : defaults.sampleRate;
    const channels = typeof payload?.channels === "number" ? payload.channels : defaults.channels;

    const wsUrl = buildEgressAudioWsUrl({
      baseWs: defaults.baseWs,
      egressPath: defaults.egressPath,
      meetUrl,
      meetingId,
      participant,
      track,
      sampleRate,
      channels,
    });
    return { wsUrl, httpBase: wsToHttpBase(defaults.baseWs) };
  });

  ipcMain.handle("desktop:protocol-validate", async (_event, payload?: Record<string, unknown>) => {
    const cfg = loadDesktopConfig();
    const defaults = getEgressDefaults(cfg);
    const meetUrl =
      typeof payload?.meetUrl === "string"
        ? payload.meetUrl
        : "https://meet.google.com/abc-defg-hij";
    const meetingId = typeof payload?.meetingId === "string" ? payload.meetingId : undefined;
    const participant =
      typeof payload?.participant === "string" ? payload.participant : defaults.participant;
    const track = typeof payload?.track === "string" ? payload.track : defaults.track;
    const sampleRate =
      typeof payload?.sampleRate === "number" ? payload.sampleRate : defaults.sampleRate;
    const channels = typeof payload?.channels === "number" ? payload.channels : defaults.channels;

    // The backend enforces JWT on `/egress-audio` upgrade (see
    // `egress-audio-gateway.ts`). Pull the access token from the auth
    // service so the diagnostic ping does not get closed with 1008.
    let token: string | undefined;
    let tenantId: string | undefined;
    try {
      const snap = authService.snapshot();
      if (snap.isAuthenticated) {
        token = (await authService.getAccessToken()) || undefined;
        tenantId = snap.tenant?.id;
      }
    } catch (err) {
      addLog(
        `Protocol validation auth lookup failed | ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const wsUrl = buildEgressAudioWsUrl({
      baseWs: defaults.baseWs,
      egressPath: defaults.egressPath,
      meetUrl,
      meetingId,
      participant,
      track,
      sampleRate,
      channels,
      token,
      tenantId,
    });
    const payloadBuffer = buildPcm16SilentFrame(sampleRate, channels);

    // Redact token from the log line — never surface raw JWTs in telemetry.
    const loggedUrl = token ? wsUrl.replace(/token=[^&]+/, "token=***") : wsUrl;
    addLog(
      `Protocol validation start | ws=${loggedUrl}${token ? "" : " (unauthenticated — backend will reject in prod)"}`,
    );

    return new Promise<{
      ok: boolean;
      wsUrl: string;
      handshake: boolean;
      payloadSentBytes: number;
      closedCode?: number;
      error?: string;
    }>((resolve) => {
      const ws = new WebSocket(wsUrl);
      let resolved = false;
      let handshake = false;

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        try {
          ws.terminate();
        } catch {}
        addLog("Protocol validation timeout");
        resolve({
          ok: false,
          wsUrl,
          handshake,
          payloadSentBytes: 0,
          error: "timeout",
        });
      }, 5000);

      ws.on("open", () => {
        handshake = true;
        ws.send(payloadBuffer, { binary: true }, (err) => {
          if (err) {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            addLog(`Protocol validation send error | ${err.message}`);
            resolve({
              ok: false,
              wsUrl,
              handshake,
              payloadSentBytes: 0,
              error: err.message,
            });
            return;
          }
          setTimeout(() => {
            try {
              ws.close(1000, "desktop-protocol-validation");
            } catch {}
          }, 100);
        });
      });

      ws.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        const ok = handshake;
        addLog(
          `Protocol validation done | handshake=${String(handshake)} | bytes=${payloadBuffer.length} | close=${code}`,
        );
        resolve({
          ok,
          wsUrl,
          handshake,
          payloadSentBytes: handshake ? payloadBuffer.length : 0,
          closedCode: code,
        });
      });

      ws.on("error", (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        addLog(`Protocol validation error | ${error.message}`);
        resolve({
          ok: false,
          wsUrl,
          handshake,
          payloadSentBytes: 0,
          error: error.message,
        });
      });
    });
  });

  ipcMain.handle("auth:login", async (_event, payload?: Record<string, unknown>) => {
    const email = ensureStringField(payload?.email, "email");
    const password = ensureStringField(payload?.password, "password");
    const backendHttpBase = sanitizeBackendBase(payload?.backendHttpBase);
    const tenantSlug =
      typeof payload?.tenantSlug === "string" && payload.tenantSlug.trim() !== ""
        ? payload.tenantSlug
        : undefined;
    const snapshot = await authService.login({
      email,
      password,
      tenantSlug,
      backendHttpBase,
    });
    return snapshot;
  });

  ipcMain.handle("auth:register", async (_event, payload?: Record<string, unknown>) => {
    const email = ensureStringField(payload?.email, "email");
    const password = ensureStringField(payload?.password, "password");
    const backendHttpBase = sanitizeBackendBase(payload?.backendHttpBase);
    const tenantSlug =
      typeof payload?.tenantSlug === "string" && payload.tenantSlug.trim() !== ""
        ? payload.tenantSlug
        : undefined;
    const tenantName =
      typeof payload?.tenantName === "string" && payload.tenantName.trim() !== ""
        ? payload.tenantName
        : undefined;
    const name =
      typeof payload?.name === "string" && payload.name.trim() !== ""
        ? payload.name
        : undefined;
    const snapshot = await authService.register({
      email,
      password,
      tenantSlug,
      tenantName,
      name,
      backendHttpBase,
    });
    return snapshot;
  });

  ipcMain.handle("auth:logout", async () => {
    await authService.logout();
    // Force stop capture on logout to avoid sending frames on a dead session.
    if (appState.captureStatus === "capturing") {
      appState.captureStatus = "idle";
      addLog("Capture stopped due to logout");
    }
    return { ok: true };
  });

  ipcMain.handle("auth:refresh", async () => {
    await authService.refreshAccessToken();
    return authService.snapshot();
  });

  ipcMain.handle("auth:get-session", () => authService.snapshot());

  ipcMain.handle("auth:get-access-token", async () => {
    try {
      return await authService.getAccessToken();
    } catch {
      return null;
    }
  });
}

app.whenReady().then(async () => {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
      addLog("Blocked webview attachment");
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");

  // Renderer CSP. Tight default; connect-src allows backend HTTP/WS and Socket.IO.
  // We rebuild the connect-src list from the loaded desktop config so env overrides
  // propagate without editing this string.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectOrigins = new Set<string>([
      "'self'",
      "http://localhost:3001",
      "ws://localhost:3001",
    ]);
    try {
      const wsBase = new URL(initialConfig.BACKEND_WS_BASE);
      connectOrigins.add(wsBase.origin);
      connectOrigins.add(wsToHttpBase(initialConfig.BACKEND_WS_BASE));
    } catch {
      /* ignore malformed url */
    }
    const connectSrc = Array.from(connectOrigins).join(" ");
    const csp = [
      "default-src 'self'",
      // Next.js dev injects inline scripts for HMR; production build is self-only.
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' blob: mediastream:",
      `connect-src ${connectSrc}`,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
        "X-Content-Type-Options": ["nosniff"],
        "Referrer-Policy": ["no-referrer"],
      },
    });
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
        });
        if (sources.length === 0) {
          addLog("displayMedia: nenhuma fonte retornada por desktopCapturer");
          callback({});
          return;
        }
        let selected = appState.selectedSourceId
          ? sources.find((source) => source.id === appState.selectedSourceId)
          : undefined;
        if (!selected) {
          selected =
            sources.find((source) => {
              const title = (source.name || "").toLowerCase();
              return title.includes("meet");
            }) || sources[0];
        }
        addLog(
          `displayMedia: fonte selecionada id=${selected.id} | name=${selected.name}`,
        );
        callback({
          video: selected,
          audio: "loopback",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`displayMedia handler error: ${message}`);
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  registerIpcHandlers();
  try {
    const snapshot = authService.hydrate();
    addLog(
      `Auth hydrated | authenticated=${snapshot.isAuthenticated} | tenant=${snapshot.tenant?.slug || "n/a"}`,
    );
  } catch (err) {
    addLog(
      `Auth hydrate failed | ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () =>
    setUpdateState({ status: "checking", message: "checking for updates..." }),
  );
  autoUpdater.on("update-available", (info) =>
    setUpdateState({
      status: "available",
      message: `update available: ${info.version}`,
      version: info.version,
    }),
  );
  autoUpdater.on("update-not-available", () =>
    setUpdateState({ status: "not-available", message: "no updates available" }),
  );
  autoUpdater.on("download-progress", (progress) =>
    setUpdateState({
      status: "downloading",
      progress: Math.round(progress.percent || 0),
      message: `downloading ${Math.round(progress.percent || 0)}%`,
    }),
  );
  autoUpdater.on("update-downloaded", () =>
    setUpdateState({
      status: "downloaded",
      message: "update downloaded, ready to install",
    }),
  );
  autoUpdater.on("error", (error) =>
    setUpdateState({
      status: "error",
      message: error?.message || "auto-updater error",
    }),
  );

  await createWindows();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindows();
    }
  });
});

app.on("window-all-closed", () => {
  if (overlayAnchorTimer) {
    clearInterval(overlayAnchorTimer);
    overlayAnchorTimer = null;
  }
  if (process.platform !== "darwin") app.quit();
});

