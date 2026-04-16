import path from "node:path";
import fs from "node:fs";
import * as electron from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import updater from "electron-updater";
import { loadDesktopConfig } from "../src/shared/desktop-config.js";
import { buildEgressAudioWsUrl, buildPcm16SilentFrame, getEgressDefaults, wsToHttpBase, } from "../src/shared/egress-audio-protocol.js";
import WebSocket from "ws";
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell, systemPreferences, } = electron;
const { autoUpdater } = updater;
const initialConfig = loadDesktopConfig();
const appState = {
    captureStatus: "idle",
    clickThrough: false,
    logs: [],
    meetingId: "abc-defg-hij",
    feedbackHttpBase: wsToHttpBase(initialConfig.BACKEND_WS_BASE),
    anchorMode: "fixed",
    update: {
        status: "idle",
        message: "updater idle",
        version: app.getVersion(),
        progress: 0,
    },
};
let controlWindow = null;
let overlayWindow = null;
const isDev = !app.isPackaged;
const devServerUrl = process.env.NEXT_DEV_SERVER_URL ?? "http://localhost:3210";
const execFileAsync = promisify(execFile);
let overlayAnchorTimer = null;
let activeWinModule = null;
function isAllowedRendererUrl(target) {
    if (isDev)
        return target.startsWith(devServerUrl);
    return target.startsWith("file://");
}
function addLog(message) {
    const line = `${new Date().toISOString()} ${message}`;
    appState.logs = [line, ...appState.logs].slice(0, 250);
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send("desktop:logs", appState.logs);
    }
}
function broadcastUpdateState() {
    if (!controlWindow || controlWindow.isDestroyed())
        return;
    controlWindow.webContents.send("desktop:update-status", appState.update);
}
function setUpdateState(next) {
    appState.update = { ...appState.update, ...next };
    broadcastUpdateState();
}
function setOverlayClickThrough(value) {
    appState.clickThrough = value;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(value, { forward: true });
    }
    addLog(`Overlay click-through ${value ? "enabled" : "disabled"}`);
}
function setOverlayAnchorMode(mode) {
    if (appState.anchorMode === mode)
        return;
    appState.anchorMode = mode;
    addLog(`Overlay anchor mode: ${mode}`);
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send("desktop:anchor-mode-updated", {
            anchorMode: appState.anchorMode,
        });
    }
}
function ensureOverlayPosition() {
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    const { workArea } = screen.getPrimaryDisplay();
    const width = 380;
    const height = 220;
    const x = Math.round(workArea.x + workArea.width - width - 24);
    const y = Math.round(workArea.y + 24);
    overlayWindow.setBounds({ x, y, width, height });
}
function positionOverlayFromAnchor(bounds) {
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    const width = 380;
    const height = 240;
    const x = Math.round(bounds.x + bounds.width - width - 18);
    const y = Math.round(bounds.y + 18);
    overlayWindow.setBounds({ x, y, width, height });
}
async function getMeetBoundsFromMacChrome() {
    try {
        const script = 'set frontUrl to ""\n' +
            'tell application "Google Chrome"\n' +
            "if not (exists front window) then return \"\"\n" +
            "set frontUrl to URL of active tab of front window\n" +
            "set wBounds to bounds of front window\n" +
            'return frontUrl & "|" & (item 1 of wBounds as string) & "," & (item 2 of wBounds as string) & "," & (item 3 of wBounds as string) & "," & (item 4 of wBounds as string)\n' +
            "end tell";
        const { stdout } = await execFileAsync("osascript", ["-e", script]);
        const line = stdout.trim();
        if (!line || !line.includes("|"))
            return null;
        const [urlPart, boundsPart] = line.split("|");
        if (!urlPart.includes("meet.google.com"))
            return null;
        const [x1, y1, x2, y2] = boundsPart.split(",").map((value) => Number(value.trim()));
        if (![x1, y1, x2, y2].every((value) => Number.isFinite(value)))
            return null;
        return { x: x1, y: y1, width: Math.max(100, x2 - x1), height: Math.max(100, y2 - y1) };
    }
    catch {
        return null;
    }
}
async function getActiveWindowModule() {
    if (activeWinModule)
        return activeWinModule;
    try {
        const imported = await import("active-win");
        activeWinModule = imported.activeWindow;
    }
    catch {
        activeWinModule = null;
    }
    return activeWinModule;
}
async function getMeetBoundsFromActiveWindow() {
    const activeWin = await getActiveWindowModule();
    if (!activeWin)
        return null;
    try {
        const details = await activeWin({
            accessibilityPermission: false,
            screenRecordingPermission: false,
        });
        if (!details)
            return null;
        const owner = (details.owner?.name || "").toLowerCase();
        const title = (details.title || "").toLowerCase();
        const isChrome = owner.includes("chrome") || owner.includes("chromium") || owner.includes("google");
        const isMeet = title.includes("meet") || title.includes("google meet");
        const bounds = details.bounds;
        if (!isChrome || !isMeet || !bounds)
            return null;
        return {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
        };
    }
    catch {
        return null;
    }
}
async function detectActiveMeetWindowBounds() {
    if (process.platform === "darwin") {
        const fromAppleScript = await getMeetBoundsFromMacChrome();
        if (fromAppleScript)
            return fromAppleScript;
        // On macOS we intentionally avoid loading active-win fallback to prevent
        // native prebuild warnings during normal runtime when Chrome context is absent.
        return null;
    }
    return getMeetBoundsFromActiveWindow();
}
function startOverlayAnchoring() {
    if (overlayAnchorTimer)
        return;
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
async function createWindows() {
    const preloadPath = path.join(app.getAppPath(), "electron/preload.mjs");
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
        width: 380,
        height: 220,
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
    const hardenWindow = (win) => {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", (event, targetUrl) => {
            if (isAllowedRendererUrl(targetUrl))
                return;
            event.preventDefault();
            addLog(`Blocked navigation to untrusted URL: ${targetUrl}`);
        });
    };
    hardenWindow(controlWindow);
    hardenWindow(overlayWindow);
    ensureOverlayPosition();
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    setOverlayClickThrough(appState.clickThrough);
    const resolveExportedRoute = (route) => {
        const baseOut = path.join(app.getAppPath(), "out");
        const normalized = route.replace(/^\/+/, "");
        const candidates = normalized
            ? [path.join(baseOut, `${normalized}.html`), path.join(baseOut, normalized, "index.html")]
            : [path.join(baseOut, "index.html")];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate))
                return `file://${candidate}`;
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
function registerIpcHandlers() {
    ipcMain.handle("desktop:get-state", () => {
        const cfg = loadDesktopConfig();
        return {
            captureStatus: appState.captureStatus,
            clickThrough: appState.clickThrough,
            logs: appState.logs,
            config: cfg,
            meetingId: appState.meetingId,
            feedbackHttpBase: appState.feedbackHttpBase,
            anchorMode: appState.anchorMode,
            update: appState.update,
        };
    });
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
    ipcMain.handle("desktop:set-click-through", (_event, payload) => {
        const enabled = typeof payload === "boolean" ? payload : Boolean(payload?.enabled);
        setOverlayClickThrough(Boolean(enabled));
        return { ok: true, clickThrough: appState.clickThrough };
    });
    ipcMain.handle("desktop:get-permission-policy", async () => {
        const platform = process.platform;
        const microphoneStatus = typeof systemPreferences.getMediaAccessStatus === "function"
            ? systemPreferences.getMediaAccessStatus("microphone")
            : "unknown";
        const cameraStatus = typeof systemPreferences.getMediaAccessStatus === "function"
            ? systemPreferences.getMediaAccessStatus("camera")
            : "unknown";
        const isAccessibilityTrusted = platform === "darwin"
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
    ipcMain.handle("desktop:request-permission", async (_event, payload) => {
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
                await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
            }
            addLog(`Accessibility trust => ${trusted ? "trusted" : "not-trusted"}`);
            return { ok: true, kind, granted: trusted };
        }
        if (kind === "screen" && process.platform === "darwin") {
            await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
            addLog("Opened macOS Screen Recording settings");
            return { ok: true, kind, granted: null };
        }
        addLog(`Permission request (${kind}) delegated to OS/browser prompt`);
        return { ok: true, kind, granted: null };
    });
    ipcMain.handle("desktop:update-check", async () => {
        if (isDev) {
            return { ok: true, skipped: true, reason: "dev-mode" };
        }
        setUpdateState({ status: "checking", message: "checking for updates..." });
        try {
            await autoUpdater.checkForUpdates();
            return { ok: true, skipped: false };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setUpdateState({ status: "error", message });
            return { ok: false, error: message };
        }
    });
    ipcMain.handle("desktop:update-download", async () => {
        if (isDev)
            return { ok: true, skipped: true, reason: "dev-mode" };
        try {
            setUpdateState({ status: "downloading", message: "downloading update..." });
            await autoUpdater.downloadUpdate();
            return { ok: true };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setUpdateState({ status: "error", message });
            return { ok: false, error: message };
        }
    });
    ipcMain.handle("desktop:update-install", () => {
        if (isDev)
            return { ok: true, skipped: true, reason: "dev-mode" };
        setUpdateState({ status: "downloaded", message: "installing update..." });
        setImmediate(() => autoUpdater.quitAndInstall());
        return { ok: true };
    });
    ipcMain.handle("desktop:set-feedback-context", (_event, payload) => {
        const nextMeetingId = typeof payload?.meetingId === "string" && payload.meetingId.trim()
            ? payload.meetingId.trim()
            : appState.meetingId;
        const nextHttpBase = typeof payload?.feedbackHttpBase === "string" && payload.feedbackHttpBase.trim()
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
        addLog(`Feedback context updated | meetingId=${appState.meetingId} | base=${appState.feedbackHttpBase}`);
        return {
            ok: true,
            meetingId: appState.meetingId,
            feedbackHttpBase: appState.feedbackHttpBase,
        };
    });
    ipcMain.handle("desktop:protocol-preview", (_event, payload) => {
        const cfg = loadDesktopConfig();
        const defaults = getEgressDefaults(cfg);
        const meetUrl = typeof payload?.meetUrl === "string"
            ? payload.meetUrl
            : "https://meet.google.com/abc-defg-hij";
        const meetingId = typeof payload?.meetingId === "string" ? payload.meetingId : undefined;
        const participant = typeof payload?.participant === "string" ? payload.participant : defaults.participant;
        const track = typeof payload?.track === "string" ? payload.track : defaults.track;
        const sampleRate = typeof payload?.sampleRate === "number" ? payload.sampleRate : defaults.sampleRate;
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
    ipcMain.handle("desktop:protocol-validate", async (_event, payload) => {
        const cfg = loadDesktopConfig();
        const defaults = getEgressDefaults(cfg);
        const meetUrl = typeof payload?.meetUrl === "string"
            ? payload.meetUrl
            : "https://meet.google.com/abc-defg-hij";
        const meetingId = typeof payload?.meetingId === "string" ? payload.meetingId : undefined;
        const participant = typeof payload?.participant === "string" ? payload.participant : defaults.participant;
        const track = typeof payload?.track === "string" ? payload.track : defaults.track;
        const sampleRate = typeof payload?.sampleRate === "number" ? payload.sampleRate : defaults.sampleRate;
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
        const payloadBuffer = buildPcm16SilentFrame(sampleRate, channels);
        addLog(`Protocol validation start | ws=${wsUrl}`);
        return new Promise((resolve) => {
            const ws = new WebSocket(wsUrl);
            let resolved = false;
            let handshake = false;
            const timeout = setTimeout(() => {
                if (resolved)
                    return;
                resolved = true;
                try {
                    ws.terminate();
                }
                catch { }
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
                        if (resolved)
                            return;
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
                        }
                        catch { }
                    }, 100);
                });
            });
            ws.on("close", (code) => {
                if (resolved)
                    return;
                resolved = true;
                clearTimeout(timeout);
                const ok = handshake;
                addLog(`Protocol validation done | handshake=${String(handshake)} | bytes=${payloadBuffer.length} | close=${code}`);
                resolve({
                    ok,
                    wsUrl,
                    handshake,
                    payloadSentBytes: handshake ? payloadBuffer.length : 0,
                    closedCode: code,
                });
            });
            ws.on("error", (error) => {
                if (resolved)
                    return;
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
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
            const sources = await desktopCapturer.getSources({
                types: ["screen", "window"],
            });
            const selected = sources[0];
            if (!selected) {
                callback({});
                return;
            }
            callback({
                video: selected,
                audio: "loopback",
            });
        }
        catch {
            callback({});
        }
    }, { useSystemPicker: true });
    registerIpcHandlers();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", message: "checking for updates..." }));
    autoUpdater.on("update-available", (info) => setUpdateState({
        status: "available",
        message: `update available: ${info.version}`,
        version: info.version,
    }));
    autoUpdater.on("update-not-available", () => setUpdateState({ status: "not-available", message: "no updates available" }));
    autoUpdater.on("download-progress", (progress) => setUpdateState({
        status: "downloading",
        progress: Math.round(progress.percent || 0),
        message: `downloading ${Math.round(progress.percent || 0)}%`,
    }));
    autoUpdater.on("update-downloaded", () => setUpdateState({
        status: "downloaded",
        message: "update downloaded, ready to install",
    }));
    autoUpdater.on("error", (error) => setUpdateState({
        status: "error",
        message: error?.message || "auto-updater error",
    }));
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
    if (process.platform !== "darwin")
        app.quit();
});
