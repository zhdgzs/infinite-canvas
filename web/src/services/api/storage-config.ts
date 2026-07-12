import { apiGet, apiPost, apiPut } from "@/services/api/client";

export type StorageBackendConfig = {
    id: string;
    name: string;
    type: "local" | "s3";
    endpoint: string;
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    objectPrefix: string;
    forcePathStyle: boolean;
    isActive: boolean;
    hasSecretAccessKey: boolean;
    secretAccessKeyMasked: string;
    fileCount: number;
    isIdentityLocked: boolean;
};

export type StorageConfig = {
    activeBackendId: string;
    localUploadDir: string;
    backends: StorageBackendConfig[];
};

export type S3BackendDraft = Omit<StorageBackendConfig, "type" | "isActive" | "fileCount" | "isIdentityLocked" | "hasSecretAccessKey" | "secretAccessKeyMasked"> & {
    id: string;
    hasSecretAccessKey?: boolean;
    secretAccessKeyMasked?: string;
    fileCount?: number;
    isIdentityLocked?: boolean;
};

export function fetchStorageConfig() {
    return apiGet<StorageConfig>("/api/storage/config");
}

export function saveStorageConfig(activeBackendId: string, backends: S3BackendDraft[], deleteIds: string[]) {
    return apiPut<StorageConfig>("/api/storage/config", { activeBackendId, backends, deleteIds });
}

export function debugStorageBackend(backend: S3BackendDraft) {
    return apiPost<{ url: string; expiresAt: string }>("/api/storage/debug", backend);
}
