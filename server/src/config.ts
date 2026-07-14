import "dotenv/config";
import { resolve } from "node:path";

const timeZone = "Asia/Shanghai";
process.env.TZ = timeZone;

function readNumber(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBoolean(name: string, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return value === "1" || value.toLowerCase() === "true";
}

export const config = {
    port: readNumber("PORT", 3000),
    host: process.env.HOST || "0.0.0.0",
    timeZone,
    databaseUrl: process.env.DATABASE_URL || "postgres://infinite_canvas:infinite_canvas@localhost:5432/infinite_canvas",
    sessionSecret: process.env.SESSION_SECRET || "",
    uploadDir: process.env.UPLOAD_DIR || "/data/uploads",
    webDistDir: process.env.WEB_DIST_DIR || resolve(process.cwd(), "../web/dist"),
    fileAccessUrlTtlSeconds: readNumber("FILE_ACCESS_URL_TTL_SECONDS", 7200),
    workerConcurrency: {
        image: readNumber("IMAGE_WORKER_CONCURRENCY", 5),
        audio: readNumber("AUDIO_WORKER_CONCURRENCY", 5),
        video: readNumber("VIDEO_WORKER_CONCURRENCY", 1),
    },
    uploadLimitsMb: {
        image: readNumber("IMAGE_MAX_UPLOAD_MB", 50),
        video: readNumber("VIDEO_MAX_UPLOAD_MB", 500),
        audio: readNumber("AUDIO_MAX_UPLOAD_MB", 100),
        file: readNumber("FILE_MAX_UPLOAD_MB", 500),
    },
    aiDebugLog: readBoolean("AI_DEBUG_LOG", false),
    cookieSecure: readBoolean("COOKIE_SECURE", false),
};

export function assertRuntimeConfig() {
    if (!config.sessionSecret || config.sessionSecret.length < 24) {
        throw new Error("SESSION_SECRET 未配置或过短，请使用 openssl rand -base64 32 生成");
    }
}
