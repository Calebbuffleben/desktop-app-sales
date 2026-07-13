import fs from "node:fs";
import path from "node:path";
const DEFAULT_CONFIG = {
    BACKEND_WS_BASE: "ws://localhost:3001",
    EGRESS_AUDIO_PATH: "/egress-audio",
    PYTHON_DIRECT_ENABLED: false,
    PYTHON_WS_BASE: "ws://localhost:8000",
    PYTHON_WS_PATH: "/ws",
    DEFAULT_SAMPLE_RATE: 16000,
    DEFAULT_CHANNELS: 1,
    ALLOW_SCRIPT_PROCESSOR_FALLBACK: true,
    ALLOW_AUDIOWORKLET_FALLBACK: true,
    TAB_AUDIO_GATE_ENABLED: false,
    TAB_AUDIO_GATE_DBFS: -45,
};
function parseBool(value, fallback) {
    if (!value)
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true")
        return true;
    if (normalized === "false")
        return false;
    return fallback;
}
function parseNumber(value, fallback) {
    if (!value)
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function parseSignedNumber(value, fallback) {
    if (!value)
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function readJsonConfigFile(baseDir) {
    const configFile = path.resolve(baseDir, "config/desktop-config.json");
    if (!fs.existsSync(configFile))
        return {};
    try {
        const raw = fs.readFileSync(configFile, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed ?? {};
    }
    catch {
        return {};
    }
}
export function loadDesktopConfig(options = {}) {
    const baseDir = options.baseDir || process.cwd();
    const fromFile = readJsonConfigFile(baseDir);
    return {
        BACKEND_WS_BASE: process.env.BACKEND_WS_BASE ??
            fromFile.BACKEND_WS_BASE ??
            DEFAULT_CONFIG.BACKEND_WS_BASE,
        EGRESS_AUDIO_PATH: process.env.EGRESS_AUDIO_PATH ??
            fromFile.EGRESS_AUDIO_PATH ??
            DEFAULT_CONFIG.EGRESS_AUDIO_PATH,
        PYTHON_DIRECT_ENABLED: parseBool(process.env.PYTHON_DIRECT_ENABLED, fromFile.PYTHON_DIRECT_ENABLED ?? DEFAULT_CONFIG.PYTHON_DIRECT_ENABLED),
        PYTHON_WS_BASE: process.env.PYTHON_WS_BASE ??
            fromFile.PYTHON_WS_BASE ??
            DEFAULT_CONFIG.PYTHON_WS_BASE,
        PYTHON_WS_PATH: process.env.PYTHON_WS_PATH ??
            fromFile.PYTHON_WS_PATH ??
            DEFAULT_CONFIG.PYTHON_WS_PATH,
        DEFAULT_SAMPLE_RATE: parseNumber(process.env.DEFAULT_SAMPLE_RATE, fromFile.DEFAULT_SAMPLE_RATE ?? DEFAULT_CONFIG.DEFAULT_SAMPLE_RATE),
        DEFAULT_CHANNELS: parseNumber(process.env.DEFAULT_CHANNELS, fromFile.DEFAULT_CHANNELS ?? DEFAULT_CONFIG.DEFAULT_CHANNELS),
        ALLOW_SCRIPT_PROCESSOR_FALLBACK: parseBool(process.env.ALLOW_SCRIPT_PROCESSOR_FALLBACK, fromFile.ALLOW_SCRIPT_PROCESSOR_FALLBACK ??
            DEFAULT_CONFIG.ALLOW_SCRIPT_PROCESSOR_FALLBACK),
        ALLOW_AUDIOWORKLET_FALLBACK: parseBool(process.env.ALLOW_AUDIOWORKLET_FALLBACK, fromFile.ALLOW_AUDIOWORKLET_FALLBACK ??
            DEFAULT_CONFIG.ALLOW_AUDIOWORKLET_FALLBACK),
        TAB_AUDIO_GATE_ENABLED: parseBool(process.env.TAB_AUDIO_GATE_ENABLED, fromFile.TAB_AUDIO_GATE_ENABLED ?? DEFAULT_CONFIG.TAB_AUDIO_GATE_ENABLED),
        TAB_AUDIO_GATE_DBFS: parseSignedNumber(process.env.TAB_AUDIO_GATE_DBFS, fromFile.TAB_AUDIO_GATE_DBFS ?? DEFAULT_CONFIG.TAB_AUDIO_GATE_DBFS),
    };
}
