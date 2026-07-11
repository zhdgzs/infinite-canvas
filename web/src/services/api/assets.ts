import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api/client";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import type { Asset, AssetKind, ImageAsset } from "@/stores/use-asset-store";

type PageResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

type RemoteAsset = {
    id: string;
    kind: AssetKind;
    title: string;
    tags: unknown;
    coverUrl: string | null;
    data: unknown;
    metadata: unknown;
    createdAt: string;
    updatedAt: string;
};

type AssetPayload = Omit<Asset, "id" | "createdAt" | "updatedAt">;

export async function fetchAssets() {
    const list = await apiGet<PageResult<RemoteAsset>>("/api/assets?page=1&pageSize=500");
    return Promise.all(list.items.map(remoteAssetToAsset));
}

export async function createAsset(payload: AssetPayload) {
    return remoteAssetToAsset(await apiPost<RemoteAsset>("/api/assets", assetToPayload(payload)));
}

export async function updateAsset(id: string, payload: Partial<AssetPayload>) {
    return remoteAssetToAsset(await apiPut<RemoteAsset>(`/api/assets/${encodeURIComponent(id)}`, assetToPayload(payload)));
}

export async function deleteAsset(id: string) {
    await apiDelete(`/api/assets/${encodeURIComponent(id)}`);
}

async function remoteAssetToAsset(asset: RemoteAsset): Promise<Asset> {
    const base = {
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        coverUrl: asset.coverUrl || "",
        tags: Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is string => typeof tag === "string") : [],
        createdAt: normalizeDate(asset.createdAt),
        updatedAt: normalizeDate(asset.updatedAt),
        metadata: isRecord(asset.metadata) ? asset.metadata : undefined,
    };
    const data = isRecord(asset.data) ? asset.data : {};
    if (asset.kind === "text") return { ...base, kind: "text", data: { content: stringValue(data.content) } };
    if (asset.kind === "image") {
        const imageData = normalizeImageData(data);
        const dataUrl = imageData.storageKey ? await resolveImageUrl(imageData.storageKey, imageData.dataUrl) : imageData.dataUrl;
        return { ...base, kind: "image", coverUrl: base.coverUrl || dataUrl, data: { ...imageData, dataUrl } };
    }
    const storageKey = stringValue(data.storageKey) || undefined;
    const url = storageKey ? await resolveMediaUrl(storageKey, stringValue(data.url)) : stringValue(data.url);
    const mediaData = { url, storageKey, width: numberValue(data.width), height: numberValue(data.height), bytes: numberValue(data.bytes), mimeType: stringValue(data.mimeType) || defaultMimeType(asset.kind), durationMs: numberValue(data.durationMs) };
    return asset.kind === "audio" ? { ...base, kind: "audio", data: mediaData } : { ...base, kind: "video", data: mediaData };
}

function assetToPayload(asset: Partial<AssetPayload>) {
    return {
        kind: asset.kind,
        title: asset.title,
        tags: asset.tags,
        coverUrl: asset.coverUrl,
        data: asset.data,
        metadata: asset.metadata,
    };
}

function normalizeImageData(data: Record<string, unknown>): ImageAsset["data"] {
    return {
        dataUrl: stringValue(data.dataUrl),
        storageKey: stringValue(data.storageKey) || undefined,
        width: numberValue(data.width) || 1,
        height: numberValue(data.height) || 1,
        bytes: numberValue(data.bytes),
        mimeType: stringValue(data.mimeType) || "image/png",
    };
}

function defaultMimeType(kind: AssetKind) {
    return kind === "audio" ? "audio/mpeg" : "video/mp4";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeDate(value: string) {
    return value ? new Date(value).toISOString() : new Date().toISOString();
}
