import fs from "node:fs";
import path from "node:path";
const DEFAULT_CONFIG = {
    BACKEND_WS_BASE: "ws://localhost:3001",
    EGRESS_AUDIO_PATH: "/egress-audio",
    DEFAULT_SAMPLE_RATE: 16000,
    DEFAULT_CHANNELS: 1,
    ALLOW_SCRIPT_PROCESSOR_FALLBACK: true,
    ALLOW_AUDIOWORKLET_FALLBACK: true,
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
function readJsonConfigFile() {
    const configFile = path.resolve(process.cwd(), "config/desktop-config.json");
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
export function loadDesktopConfig() {
    const fromFile = readJsonConfigFile();
    return {
        BACKEND_WS_BASE: process.env.BACKEND_WS_BASE ??
            fromFile.BACKEND_WS_BASE ??
            DEFAULT_CONFIG.BACKEND_WS_BASE,
        EGRESS_AUDIO_PATH: process.env.EGRESS_AUDIO_PATH ??
            fromFile.EGRESS_AUDIO_PATH ??
            DEFAULT_CONFIG.EGRESS_AUDIO_PATH,
        DEFAULT_SAMPLE_RATE: parseNumber(process.env.DEFAULT_SAMPLE_RATE, fromFile.DEFAULT_SAMPLE_RATE ?? DEFAULT_CONFIG.DEFAULT_SAMPLE_RATE),
        DEFAULT_CHANNELS: parseNumber(process.env.DEFAULT_CHANNELS, fromFile.DEFAULT_CHANNELS ?? DEFAULT_CONFIG.DEFAULT_CHANNELS),
        ALLOW_SCRIPT_PROCESSOR_FALLBACK: parseBool(process.env.ALLOW_SCRIPT_PROCESSOR_FALLBACK, fromFile.ALLOW_SCRIPT_PROCESSOR_FALLBACK ??
            DEFAULT_CONFIG.ALLOW_SCRIPT_PROCESSOR_FALLBACK),
        ALLOW_AUDIOWORKLET_FALLBACK: parseBool(process.env.ALLOW_AUDIOWORKLET_FALLBACK, fromFile.ALLOW_AUDIOWORKLET_FALLBACK ??
            DEFAULT_CONFIG.ALLOW_AUDIOWORKLET_FALLBACK),
    };
}
