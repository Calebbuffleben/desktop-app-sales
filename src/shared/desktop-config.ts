import fs from "node:fs";
import path from "node:path";

export type DesktopProvider = "railway" | "cloud_run" | "local";

type ProviderUrls = {
  BACKEND_WS_BASE: string;
  PYTHON_WS_BASE: string;
};

export type DesktopConfig = {
  provider: DesktopProvider;
  BACKEND_WS_BASE: string;
  EGRESS_AUDIO_PATH: string;
  /** Bypass do backend: áudio e feedback direto com o python-service. */
  PYTHON_DIRECT_ENABLED: boolean;
  /** Base WS do python-service (ex: ws://localhost:8000 ou wss://python.up.railway.app). */
  PYTHON_WS_BASE: string;
  PYTHON_WS_PATH: string;
  DEFAULT_SAMPLE_RATE: number;
  DEFAULT_CHANNELS: number;
  ALLOW_SCRIPT_PROCESSOR_FALLBACK: boolean;
  ALLOW_AUDIOWORKLET_FALLBACK: boolean;
  TAB_AUDIO_GATE_ENABLED: boolean;
  TAB_AUDIO_GATE_DBFS: number;
};

const PROVIDERS: Record<DesktopProvider, ProviderUrls> = {
  cloud_run: {
    BACKEND_WS_BASE:
      "wss://backend-770631129946.southamerica-east1.run.app",
    PYTHON_WS_BASE:
      "wss://python-service-770631129946.southamerica-east1.run.app",
  },
  railway: {
    BACKEND_WS_BASE:
      "wss://backend-analysis-production-a688.up.railway.app",
    PYTHON_WS_BASE: "wss://text-analysis-production.up.railway.app",
  },
  local: {
    BACKEND_WS_BASE: "ws://localhost:3001",
    PYTHON_WS_BASE: "ws://localhost:8000",
  },
};

const DEFAULT_CONFIG: Omit<DesktopConfig, "provider" | keyof ProviderUrls> = {
  EGRESS_AUDIO_PATH: "/egress-audio",
  PYTHON_DIRECT_ENABLED: false,
  PYTHON_WS_PATH: "/ws",
  DEFAULT_SAMPLE_RATE: 16000,
  DEFAULT_CHANNELS: 1,
  ALLOW_SCRIPT_PROCESSOR_FALLBACK: true,
  ALLOW_AUDIOWORKLET_FALLBACK: true,
  TAB_AUDIO_GATE_ENABLED: false,
  TAB_AUDIO_GATE_DBFS: -45,
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

function parseSignedNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProvider(value: string | undefined): DesktopProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "railway" ||
    normalized === "cloud_run" ||
    normalized === "local"
  ) {
    return normalized;
  }
  return undefined;
}

type LoadOptions = {
  /**
   * Base directory to resolve `config/desktop-config.json`.
   * In Electron main process, pass `app.getAppPath()`; when packaged, `process.cwd()`
   * usually points to `/` and the config file would be ignored.
   */
  baseDir?: string;
};

type ConfigFile = Partial<DesktopConfig> & {
  provider?: string;
  providers?: Partial<Record<DesktopProvider, Partial<ProviderUrls>>>;
};

function readJsonConfigFile(baseDir: string): ConfigFile {
  const configFile = path.resolve(baseDir, "config/desktop-config.json");
  if (!fs.existsSync(configFile)) return {};
  try {
    const raw = fs.readFileSync(configFile, "utf-8");
    const parsed = JSON.parse(raw) as ConfigFile;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function loadDesktopConfig(options: LoadOptions = {}): DesktopConfig {
  const baseDir = options.baseDir || process.cwd();
  const fromFile = readJsonConfigFile(baseDir);
  const provider =
    parseProvider(process.env.DESKTOP_PROVIDER) ??
    parseProvider(fromFile.provider) ??
    "cloud_run";
  const profile = {
    ...PROVIDERS[provider],
    ...fromFile.providers?.[provider],
  };
  return {
    provider,
    BACKEND_WS_BASE:
      process.env.BACKEND_WS_BASE ??
      fromFile.BACKEND_WS_BASE ??
      profile.BACKEND_WS_BASE,
    EGRESS_AUDIO_PATH:
      process.env.EGRESS_AUDIO_PATH ??
      fromFile.EGRESS_AUDIO_PATH ??
      DEFAULT_CONFIG.EGRESS_AUDIO_PATH,
    PYTHON_DIRECT_ENABLED: parseBool(
      process.env.PYTHON_DIRECT_ENABLED,
      fromFile.PYTHON_DIRECT_ENABLED ?? DEFAULT_CONFIG.PYTHON_DIRECT_ENABLED,
    ),
    PYTHON_WS_BASE:
      process.env.PYTHON_WS_BASE ??
      fromFile.PYTHON_WS_BASE ??
      profile.PYTHON_WS_BASE,
    PYTHON_WS_PATH:
      process.env.PYTHON_WS_PATH ??
      fromFile.PYTHON_WS_PATH ??
      DEFAULT_CONFIG.PYTHON_WS_PATH,
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
    TAB_AUDIO_GATE_ENABLED: parseBool(
      process.env.TAB_AUDIO_GATE_ENABLED,
      fromFile.TAB_AUDIO_GATE_ENABLED ?? DEFAULT_CONFIG.TAB_AUDIO_GATE_ENABLED,
    ),
    TAB_AUDIO_GATE_DBFS: parseSignedNumber(
      process.env.TAB_AUDIO_GATE_DBFS,
      fromFile.TAB_AUDIO_GATE_DBFS ?? DEFAULT_CONFIG.TAB_AUDIO_GATE_DBFS,
    ),
  };
}
