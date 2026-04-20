const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_INVOKE_CHANNELS = new Set([
  "desktop:get-state",
  "desktop:capture-start",
  "desktop:capture-stop",
  "desktop:set-click-through",
  "desktop:set-overlay-window-visible",
  "desktop:set-feedback-context",
  "desktop:protocol-preview",
  "desktop:protocol-validate",
  "desktop:get-permission-policy",
  "desktop:request-permission",
  "desktop:update-check",
  "desktop:update-download",
  "desktop:update-install",
  "desktop:check-capture-readiness",
  "desktop:list-display-sources",
  "desktop:set-selected-source",
  "desktop:capture-error",
  "auth:login",
  "auth:register",
  "auth:logout",
  "auth:refresh",
  "auth:get-session",
  "auth:get-access-token",
  "members:list",
  "members:update-role",
  "members:remove",
  "invites:list",
  "invites:create",
  "invites:revoke",
  "invites:accept",
  "invites:accept-public",
  "billing:subscription",
  "billing:upgrade",
]);

const ALLOWED_LISTEN_CHANNELS = new Set([
  "desktop:feedback-context-updated",
  "desktop:anchor-mode-updated",
  "desktop:update-status",
  "desktop:logs",
  "desktop:log-entry",
  "desktop:selected-source-updated",
  "auth:session-updated",
]);

function ensureObjectOrUndefined(value) {
  if (value === undefined) return undefined;
  if (value && typeof value === "object") return value;
  throw new Error("IPC payload must be an object");
}

function invokeStrict(channel, payload) {
  if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC invoke channel: ${channel}`);
  }
  return ipcRenderer.invoke(channel, ensureObjectOrUndefined(payload));
}

function onStrict(channel, handler) {
  if (!ALLOWED_LISTEN_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC listen channel: ${channel}`);
  }
  if (typeof handler !== "function") {
    throw new Error("IPC handler must be a function");
  }
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld(
  "desktopApi",
  Object.freeze({
    getState: () => invokeStrict("desktop:get-state"),
    startCapture: () => invokeStrict("desktop:capture-start"),
    stopCapture: () => invokeStrict("desktop:capture-stop"),
    setClickThrough: (enabled) =>
      invokeStrict("desktop:set-click-through", { enabled: Boolean(enabled) }),
    setOverlayWindowVisible: (visible) =>
      invokeStrict("desktop:set-overlay-window-visible", { visible: Boolean(visible) }),
    setFeedbackContext: (payload) =>
      invokeStrict("desktop:set-feedback-context", ensureObjectOrUndefined(payload)),
    protocolPreview: (payload) => invokeStrict("desktop:protocol-preview", payload),
    protocolValidate: (payload) => invokeStrict("desktop:protocol-validate", payload),
    getPermissionPolicy: () => invokeStrict("desktop:get-permission-policy"),
    requestPermission: (kind) => invokeStrict("desktop:request-permission", { kind }),
    checkForUpdates: () => invokeStrict("desktop:update-check"),
    downloadUpdate: () => invokeStrict("desktop:update-download"),
    installUpdateNow: () => invokeStrict("desktop:update-install"),
    checkCaptureReadiness: () => invokeStrict("desktop:check-capture-readiness"),
    listDisplaySources: () => invokeStrict("desktop:list-display-sources"),
    setSelectedSource: (sourceId) =>
      invokeStrict("desktop:set-selected-source", { sourceId: String(sourceId || "") }),
    reportCaptureError: (payload) =>
      invokeStrict("desktop:capture-error", ensureObjectOrUndefined(payload)),
    onFeedbackContextUpdated: (handler) =>
      onStrict("desktop:feedback-context-updated", handler),
    onAnchorModeUpdated: (handler) => onStrict("desktop:anchor-mode-updated", handler),
    onUpdateStatus: (handler) => onStrict("desktop:update-status", handler),
    onLogs: (handler) => onStrict("desktop:logs", handler),
    onLogEntry: (handler) => onStrict("desktop:log-entry", handler),
    onSelectedSourceUpdated: (handler) =>
      onStrict("desktop:selected-source-updated", handler),
    authLogin: (payload) => invokeStrict("auth:login", payload),
    authRegister: (payload) => invokeStrict("auth:register", payload),
    authLogout: () => invokeStrict("auth:logout"),
    authRefresh: () => invokeStrict("auth:refresh"),
    getAuthSession: () => invokeStrict("auth:get-session"),
    getAccessToken: () => invokeStrict("auth:get-access-token"),
    onAuthSessionUpdated: (handler) => onStrict("auth:session-updated", handler),
    membersList: () => invokeStrict("members:list"),
    membersUpdateRole: (payload) => invokeStrict("members:update-role", payload),
    membersRemove: (payload) => invokeStrict("members:remove", payload),
    invitesList: () => invokeStrict("invites:list"),
    invitesCreate: (payload) => invokeStrict("invites:create", payload),
    invitesRevoke: (payload) => invokeStrict("invites:revoke", payload),
    invitesAccept: (payload) => invokeStrict("invites:accept", payload),
    invitesAcceptPublic: (payload) => invokeStrict("invites:accept-public", payload),
    billingSubscription: () => invokeStrict("billing:subscription"),
    billingUpgrade: (payload) => invokeStrict("billing:upgrade", payload),
  }),
);
