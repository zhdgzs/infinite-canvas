import { apiDelete, apiUpload } from "@/services/api/client";
import { resolveStoredFileUrl } from "@/services/image-storage";
import { isMediaStorageKey } from "@/services/storage-keys";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

type UploadedFileResponse = {
    storageKey: string;
    kind: string;
    mimeType: string;
    bytes: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const stored = await uploadFile(blob, `${prefix}.${fileExtension(blob.type)}`);
    const url = await resolveMediaUrl(stored.storageKey);
    return { url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType, width: stored.width, height: stored.height, durationMs: stored.durationMs };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return resolveStoredFileUrl(storageKey, fallback);
}

export async function getMediaBlob(storageKey: string) {
    const url = await resolveMediaUrl(storageKey);
    return url ? (await fetch(url)).blob() : null;
}

export async function setMediaBlob(_storageKey: string, blob: Blob) {
    const stored = await uploadFile(blob, `media.${fileExtension(blob.type)}`);
    return resolveMediaUrl(stored.storageKey);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(Array.from(new Set(keys)).map((key) => apiDelete(`/api/files/${encodeURIComponent(key)}`).catch(() => undefined)));
}

export async function cleanupUnusedMedia(_usedData: unknown) {
    // 服务端文件默认只逻辑删除，暂不做自动清理。
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && isMediaStorageKey(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

async function uploadFile(blob: Blob, filename: string) {
    const formData = new FormData();
    formData.append("file", blob, filename);
    return apiUpload<UploadedFileResponse>("/api/files", formData);
}

function fileExtension(mimeType: string) {
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("quicktime")) return "mov";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return "bin";
}
