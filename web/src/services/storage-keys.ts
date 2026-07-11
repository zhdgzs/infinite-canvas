export type StoredFileKind = "image" | "video" | "audio" | "file" | "video-reference" | "audio-reference";

const STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference)[:_]/;

export function storageKeyKind(value: string): StoredFileKind | null {
    return (value.match(STORAGE_KEY_PATTERN)?.[1] as StoredFileKind | undefined) || null;
}

export function isStoredFileKey(value: string) {
    return Boolean(storageKeyKind(value));
}

export function isImageStorageKey(value: string) {
    return storageKeyKind(value) === "image";
}

export function isMediaStorageKey(value: string) {
    const kind = storageKeyKind(value);
    return kind === "video" || kind === "audio" || kind === "file" || kind === "video-reference" || kind === "audio-reference";
}
