export type FileKind = "image" | "video" | "audio";

export type StoredFileMeta = {
    storageKey: string;
    kind: FileKind;
    path: string;
    originalName?: string;
    mimeType: string;
    bytes: number;
    width?: number;
    height?: number;
    durationMs?: number;
    sha256?: string;
    storageBackendId: string;
};
