import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

import type { FileKind } from "./types.js";

const execFileAsync = promisify(execFile);

export async function readMediaMetadata(filePath: string, kind: FileKind) {
    if (kind === "image") {
        const meta = await sharp(filePath).metadata();
        return {
            width: meta.width,
            height: meta.height,
        };
    }
    return readFfprobeMetadata(filePath, kind);
}

export async function readBufferMediaMetadata(buffer: Buffer, kind: FileKind) {
    if (kind !== "image") return {};
    const meta = await sharp(buffer).metadata();
    return { width: meta.width, height: meta.height };
}

async function readFfprobeMetadata(filePath: string, kind: FileKind) {
    try {
        const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeout: 10000 });
        const parsed = JSON.parse(stdout) as {
            streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
            format?: { duration?: string };
        };
        const stream = parsed.streams?.find((item) => item.codec_type === (kind === "video" ? "video" : "audio"));
        const duration = Number(stream?.duration || parsed.format?.duration || 0);
        return {
            width: stream?.width,
            height: stream?.height,
            durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : undefined,
        };
    } catch {
        return {};
    }
}
