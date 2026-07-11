import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import { nanoid } from "nanoid";
import type { MultipartFile } from "@fastify/multipart";

import { config } from "../config.js";
import { assertAllowedMime, extFromMime, kindFromMime } from "./mime.js";
import { readMediaMetadata } from "./metadata.js";
import type { StoredFileMeta } from "./types.js";

export async function storeMultipartFile(userId: string, file: MultipartFile): Promise<StoredFileMeta> {
    const tempPath = resolve(tmpdir(), `infinite-canvas-upload-${process.pid}-${Date.now()}-${nanoid()}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const output = createWriteStream(tempPath);
    file.file.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
    });
    await pipeline(file.file, output);
    try {
        const detected = await fileTypeFromFile(tempPath);
        if (!detected?.mime) throw new Error("无法识别文件类型");
        const kind = assertAllowedMime(detected.mime);
        assertSizeLimit(kind, bytes);
        const storageKey = `${kind}_${nanoid()}`;
        const ext = extFromMime(detected.mime, kind);
        const now = new Date();
        const relativePath = `${userId}/${String(now.getFullYear())}/${String(now.getMonth() + 1).padStart(2, "0")}/${storageKey}.${ext}`;
        const finalPath = join(config.uploadDir, relativePath);
        await mkdir(dirname(finalPath), { recursive: true });
        await rename(tempPath, finalPath);
        const meta = await readMediaMetadata(finalPath, kind);
        return {
            storageKey,
            kind,
            path: relativePath,
            originalName: file.filename,
            mimeType: detected.mime,
            bytes,
            sha256: hash.digest("hex"),
            ...meta,
        };
    } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function storeBufferFile(userId: string, buffer: Buffer, filename: string, mimeTypeHint?: string): Promise<StoredFileMeta> {
    const detected = await fileTypeFromBuffer(buffer);
    const mimeType = detected?.mime || mimeTypeHint || "application/octet-stream";
    const kind = kindFromMime(mimeType);
    if (!kind) throw new Error("生成结果不是支持的媒体文件");
    const storageKey = `${kind}_${nanoid()}`;
    const ext = detected?.ext || extFromMime(mimeType, kind);
    const now = new Date();
    const relativePath = `${userId}/${String(now.getFullYear())}/${String(now.getMonth() + 1).padStart(2, "0")}/${storageKey}.${ext}`;
    const finalPath = join(config.uploadDir, relativePath);
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, buffer);
    const meta = await readMediaMetadata(finalPath, kind);
    return {
        storageKey,
        kind,
        path: relativePath,
        originalName: filename,
        mimeType,
        bytes: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        ...meta,
    };
}

export function absoluteUploadPath(relativePath: string) {
    return join(config.uploadDir, relativePath);
}

export async function fileStat(relativePath: string) {
    return stat(absoluteUploadPath(relativePath));
}

export function fileStream(relativePath: string, options?: { start?: number; end?: number }) {
    return createReadStream(absoluteUploadPath(relativePath), options);
}

function assertSizeLimit(kind: StoredFileMeta["kind"], bytes: number) {
    const maxMb = config.uploadLimitsMb[kind];
    if (bytes > maxMb * 1024 * 1024) throw new Error(`${kind} 文件不能超过 ${maxMb}MB`);
}
