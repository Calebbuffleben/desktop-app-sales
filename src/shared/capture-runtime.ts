import {
  DesktopAudioCaptureService,
  type AudioMeter,
  type AudioWsState,
} from "./audio-capture-service";

/**
 * Capture must outlive the Next.js page. `/live-floor` unmounts Home and
 * used to call stop() in a useEffect cleanup, which closed the Python audio
 * sockets while Electron still showed captureStatus=capturing.
 */
type CaptureUiHooks = {
  hostLog: (message: string) => void;
  hostState: (state: AudioWsState) => void;
  hostMeter: (meter: AudioMeter) => void;
  remoteLog: (message: string) => void;
  remoteState: (state: AudioWsState) => void;
  remoteMeter: (meter: AudioMeter) => void;
  remoteFeedback: (payload: Record<string, unknown>) => void;
};

const hooks: Partial<CaptureUiHooks> = {};

export const hostCaptureService = new DesktopAudioCaptureService(
  (message) => hooks.hostLog?.(message),
  (state) => hooks.hostState?.(state),
  (meter) => hooks.hostMeter?.(meter),
);

export const remoteCaptureService = new DesktopAudioCaptureService(
  (message) => hooks.remoteLog?.(message),
  (state) => hooks.remoteState?.(state),
  (meter) => hooks.remoteMeter?.(meter),
  (payload) => hooks.remoteFeedback?.(payload),
);

export function bindCaptureUi(next: CaptureUiHooks): () => void {
  Object.assign(hooks, next);
  return () => {
    if (hooks.hostLog === next.hostLog) hooks.hostLog = undefined;
    if (hooks.hostState === next.hostState) hooks.hostState = undefined;
    if (hooks.hostMeter === next.hostMeter) hooks.hostMeter = undefined;
    if (hooks.remoteLog === next.remoteLog) hooks.remoteLog = undefined;
    if (hooks.remoteState === next.remoteState) hooks.remoteState = undefined;
    if (hooks.remoteMeter === next.remoteMeter) hooks.remoteMeter = undefined;
    if (hooks.remoteFeedback === next.remoteFeedback) {
      hooks.remoteFeedback = undefined;
    }
  };
}

export function getCaptureUiStatus(): "idle" | "starting" | "capturing" {
  const host = hostCaptureService.getStatus();
  const remote = remoteCaptureService.getStatus();
  if (host === "starting" || remote === "starting") return "starting";
  if (host === "capturing" || remote === "capturing") return "capturing";
  return "idle";
}

