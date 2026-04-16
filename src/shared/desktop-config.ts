import fs from "node:fs";
import path from "node:path";

export type DesktopConfig = {
  BACKEND_WS_BASE: string;
  EGRESS_AUDIO_PATH: string;
  DEFAULT_SAMPLE_RATE: number;
  DEFAULT_CHANNELS: number;
  ALLOW_SCRIPT_PROCESSOR_FALLBACK: boolean;
  ALLOW_AUDIOWORKLET_FALLBACK: boolean;
};

const DEFAULT_CONFIG: DesktopConfig = {
  BACKEND_WS_BASE: "ws://localhost:3001",
  EGRESS_AUDIO_PATH: "/egress-audio",
  DEFAULT_SAMPLE_RATE: 16000,
  DEFAULT_CHANNELS: 1,
  ALLOW_SCRIPT_PROCESSOR_FALLBACK: true,
  ALLOW_AUDIOWORKLET_FALLBACK: true,
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type LoadOptions = {
  /**
   * Base directory to resolve `config/desktop-config.json`.
   * In Electron main process, pass `app.getAppPath()`; when packaged, `process.cwd()`
   * usually points to `/` and the config file would be ignored.
   */
  baseDir?: string;
};

function readJsonConfigFile(baseDir: string): Partial<DesktopConfig> {
  const configFile = path.resolve(baseDir, "config/desktop-config.json");
  if (!fs.existsSync(configFile)) return {};
  try {
    const raw = fs.readFileSync(configFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function loadDesktopConfig(options: LoadOptions = {}): DesktopConfig {
  const baseDir = options.baseDir || process.cwd();
  const fromFile = readJsonConfigFile(baseDir);
  return {
    BACKEND_WS_BASE:
      process.env.BACKEND_WS_BASE ??
      fromFile.BACKEND_WS_BASE ??
      DEFAULT_CONFIG.BACKEND_WS_BASE,
    EGRESS_AUDIO_PATH:
      process.env.EGRESS_AUDIO_PATH ??
      fromFile.EGRESS_AUDIO_PATH ??
      DEFAULT_CONFIG.EGRESS_AUDIO_PATH,
    DEFAULT_SAMPLE_RATE: parseNumber(
      process.env.DEFAULT_SAMPLE_RATE,
      fromFile.DEFAULT_SAMPLE_RATE ?? DEFAULT_CONFIG.DEFAULT_SAMPLE_RATE,
    ),
    DEFAULT_CHANNELS: parseNumber(
      process.env.DEFAULT_CHANNELS,
      fromFile.DEFAULT_CHANNELS ?? DEFAULT_CONFIG.DEFAULT_CHANNELS,
    ),
    ALLOW_SCRIPT_PROCESSOR_FALLBACK: parseBool(
      process.env.ALLOW_SCRIPT_PROCESSOR_FALLBACK,
      fromFile.ALLOW_SCRIPT_PROCESSOR_FALLBACK ??
        DEFAULT_CONFIG.ALLOW_SCRIPT_PROCESSOR_FALLBACK,
    ),
    ALLOW_AUDIOWORKLET_FALLBACK: parseBool(
      process.env.ALLOW_AUDIOWORKLET_FALLBACK,
      fromFile.ALLOW_AUDIOWORKLET_FALLBACK ??
        DEFAULT_CONFIG.ALLOW_AUDIOWORKLET_FALLBACK,
    ),
  };
}
