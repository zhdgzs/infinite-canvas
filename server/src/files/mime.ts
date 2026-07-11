import type { FileKind } from "./types.js";

const imageExtByMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
};

const videoExtByMime: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
};

const audioExtByMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
};

export function kindFromMime(mimeType: string): FileKind | null {
    if (mimeType in imageExtByMime) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return null;
}

export function extFromMime(mimeType: string, kind: FileKind) {
    if (kind === "image") return imageExtByMime[mimeType] || "img";
    if (kind === "video") return videoExtByMime[mimeType] || "video";
    return audioExtByMime[mimeType] || "audio";
}

export function assertAllowedMime(mimeType: string) {
    const kind = kindFromMime(mimeType);
    if (!kind) throw new Error("仅支持图片、视频或音频文件");
    if (kind === "image" && !(mimeType in imageExtByMime)) throw new Error("仅支持 png、jpeg、webp、gif、avif 图片");
    return kind;
}
