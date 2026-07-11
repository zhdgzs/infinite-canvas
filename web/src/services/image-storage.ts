import { apiDelete, apiGet, apiUpload } from "@/services/api/client";
import { isImageStorageKey } from "@/services/storage-keys";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type UploadedFileResponse = {
    storageKey: string;
    kind: string;
    mimeType: string;
    bytes: number;
    width?: number;
    height?: number;
};

type AccessUrlResponse = {
    url: string;
    expiresAt: string;
    mimeType: string;
    bytes: number;
};

const accessUrls = new Map<string, { url: string; expiresAt: number }>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const stored = await uploadFile(blob, "image.png");
    const url = await resolveImageUrl(stored.storageKey);
    return { url, storageKey: stored.storageKey, width: stored.width || 1, height: stored.height || 1, bytes: stored.bytes, mimeType: stored.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return resolveStoredFileUrl(storageKey, fallback);
}

export async function getImageBlob(storageKey: string) {
    const url = await resolveImageUrl(storageKey);
    return url ? (await fetch(url)).blob() : null;
}

export async function setImageBlob(_storageKey: string, blob: Blob) {
    const stored = await uploadFile(blob, "image.png");
    return resolveImageUrl(stored.storageKey);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            accessUrls.delete(key);
            await apiDelete(`/api/files/${encodeURIComponent(key)}`).catch(() => undefined);
        }),
    );
}

export async function cleanupUnusedImages(_usedData: unknown) {
    // 服务端文件默认只逻辑删除，暂不做自动清理。
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && isImageStorageKey(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

async function uploadFile(blob: Blob, filename: string) {
    const formData = new FormData();
    formData.append("file", blob, filename);
    return apiUpload<UploadedFileResponse>("/api/files", formData);
}

export async function resolveStoredFileUrl(storageKey: string, fallback = "") {
    const cached = accessUrls.get(storageKey);
    if (cached && cached.expiresAt - Date.now() > 30_000) return cached.url;
    const result = await apiGet<AccessUrlResponse>(`/api/files/${encodeURIComponent(storageKey)}/access-url`).catch(() => null);
    if (!result?.url) return fallback;
    accessUrls.set(storageKey, { url: result.url, expiresAt: Date.parse(result.expiresAt) || 0 });
    return result.url;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
