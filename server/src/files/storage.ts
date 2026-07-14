import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MultipartFile } from "@fastify/multipart";
import { eq } from "drizzle-orm";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import { nanoid } from "nanoid";

import { config } from "../config.js";
import { db } from "../db/client.js";
import { storageBackends } from "../db/schema.js";
import { AppError } from "../lib/api-response.js";
import { moveTempFile } from "./local-storage.js";
import { readBufferMediaMetadata, readMediaMetadata } from "./metadata.js";
import { assertAllowedMime, extFromMime, kindFromMime } from "./mime.js";
import type { StoredFileMeta } from "./types.js";

export type StorageBackend = typeof storageBackends.$inferSelect;

export async function activeStorageBackend() {
    const [backend] = await db.select().from(storageBackends).where(eq(storageBackends.isActive, true)).limit(1);
    if (!backend) throw new AppError(500, "未配置默认存储后端", 500);
    return backend;
}

export async function storageBackendById(id: string) {
    const [backend] = await db.select().from(storageBackends).where(eq(storageBackends.id, id)).limit(1);
    if (!backend) throw new AppError(500, "文件关联的存储后端不存在", 500);
    return backend;
}

export async function storeMultipartFile(userId: string, backend: StorageBackend, file: MultipartFile): Promise<StoredFileMeta> {
    const tempPath = resolve(tmpdir(), `infinite-canvas-upload-${process.pid}-${Date.now()}-${nanoid()}`);
    const hash = createHash("sha256");
    let bytes = 0;
    file.file.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
    });
    await pipeline(file.file, createWriteStream(tempPath));
    try {
        const detected = await fileTypeFromFile(tempPath);
        if (!detected?.mime) throw new AppError(400, "无法识别文件类型", 400);
        const kind = assertAllowedMime(detected.mime);
        assertSizeLimit(kind, bytes);
        const target = createTarget(userId, kind, extFromMime(detected.mime, kind), backend);
        const meta = backend.type === "local" ? await storeLocalTemp(tempPath, target.path, kind) : await storeS3Temp(backend, tempPath, target.path, detected.mime, bytes, kind);
        return { ...target, originalName: file.filename, mimeType: detected.mime, bytes, sha256: hash.digest("hex"), ...meta };
    } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
    }
}

export async function storeBufferFile(userId: string, backend: StorageBackend, buffer: Buffer, filename: string, mimeTypeHint?: string): Promise<StoredFileMeta> {
    const detected = await fileTypeFromBuffer(buffer);
    const mimeType = detected?.mime || mimeTypeHint || "application/octet-stream";
    const kind = kindFromMime(mimeType);
    if (!kind) throw new AppError(400, "生成结果不是支持的媒体文件", 400);
    const target = createTarget(userId, kind, detected?.ext || extFromMime(mimeType, kind), backend);
    let meta;
    if (backend.type === "local") {
        const finalPath = join(config.uploadDir, target.path);
        await mkdir(dirname(finalPath), { recursive: true });
        await writeFile(finalPath, buffer);
        meta = await readMediaMetadata(finalPath, kind);
    } else {
        await providerCall("S3 文件写入失败", () => s3Client(backend).send(new PutObjectCommand({ Bucket: required(backend.bucket, "Bucket"), Key: target.path, Body: buffer, ContentLength: buffer.byteLength, ContentType: mimeType })));
        meta = await readBufferMediaMetadata(buffer, kind);
    }
    return { ...target, originalName: filename, mimeType, bytes: buffer.byteLength, sha256: createHash("sha256").update(buffer).digest("hex"), ...meta };
}

export async function readStoredBuffer(backend: StorageBackend, path: string) {
    if (backend.type === "local") return readFile(join(config.uploadDir, path));
    const response = await providerCall("S3 文件读取失败", () => s3Client(backend).send(new GetObjectCommand({ Bucket: required(backend.bucket, "Bucket"), Key: path })));
    if (!response.Body) throw new AppError(404, "存储对象不存在", 404);
    return Buffer.from(await response.Body.transformToByteArray());
}

export async function s3AccessUrl(backend: StorageBackend, path: string, expiresIn: number) {
    return providerCall("S3 访问链接生成失败", () => getSignedUrl(s3Client(backend, true), new GetObjectCommand({ Bucket: required(backend.bucket, "Bucket"), Key: path }), { expiresIn }));
}

export async function debugS3Backend(backend: StorageBackend) {
    const client = s3Client(backend);
    const bucket = required(backend.bucket, "Bucket");
    const body = Buffer.from(`infinite-canvas storage debug ${new Date().toISOString()}`);
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const probeKey = objectPath(backend.objectPrefix, `_debug/probe-${nanoid()}.txt`);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: probeKey, Body: body, ContentType: "text/plain" }));
    const read = await client.send(new GetObjectCommand({ Bucket: bucket, Key: probeKey }));
    if (!read.Body || Buffer.compare(Buffer.from(await read.Body.transformToByteArray()), body) !== 0) throw new AppError(502, "S3 调试对象读取校验失败", 502);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey }));
    const publicKey = objectPath(backend.objectPrefix, `_debug/public-${nanoid()}.txt`);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: publicKey, Body: body, ContentType: "text/plain" }));
    const url = await s3AccessUrl(backend, publicKey, 900);
    const timer = setTimeout(() => void client.send(new DeleteObjectCommand({ Bucket: bucket, Key: publicKey })).catch(() => undefined), 10 * 60 * 1000);
    timer.unref();
    return { url, expiresAt: new Date(Date.now() + 15 * 60 * 1000) };
}

function s3Client(backend: StorageBackend, publicAccess = false) {
    if (backend.type !== "s3") throw new AppError(400, "当前后端不是 S3 存储", 400);
    const endpoint = publicAccess && backend.publicEndpoint ? backend.publicEndpoint : backend.endpoint;
    return new S3Client({
        region: backend.region || "us-east-1",
        endpoint: endpoint || undefined,
        forcePathStyle: backend.forcePathStyle,
        credentials: { accessKeyId: required(backend.accessKeyId, "Access Key"), secretAccessKey: required(backend.secretAccessKey, "Secret Key") },
    });
}

function createTarget(userId: string, kind: StoredFileMeta["kind"], ext: string, backend: StorageBackend) {
    const storageKey = `${kind}_${nanoid()}`;
    const date = new Date();
    const relative = `${userId}/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${storageKey}.${ext}`;
    return { storageKey, kind, path: backend.type === "s3" ? objectPath(backend.objectPrefix, relative) : relative, storageBackendId: backend.id };
}

async function storeLocalTemp(tempPath: string, path: string, kind: StoredFileMeta["kind"]) {
    const finalPath = join(config.uploadDir, path);
    await mkdir(dirname(finalPath), { recursive: true });
    await moveTempFile(tempPath, finalPath);
    return readMediaMetadata(finalPath, kind);
}

async function storeS3Temp(backend: StorageBackend, tempPath: string, path: string, mimeType: string, bytes: number, kind: StoredFileMeta["kind"]) {
    await providerCall("S3 文件写入失败", () => s3Client(backend).send(new PutObjectCommand({ Bucket: required(backend.bucket, "Bucket"), Key: path, Body: createReadStream(tempPath), ContentLength: bytes, ContentType: mimeType })));
    return readMediaMetadata(tempPath, kind);
}

function objectPath(prefix: string | null, path: string) {
    return [prefix?.replace(/^\/+|\/+$/g, ""), path.replace(/^\/+/, "")].filter(Boolean).join("/");
}

function required(value: string | null, label: string) {
    if (!value?.trim()) throw new AppError(400, `请配置 ${label}`, 400);
    return value.trim();
}

function assertSizeLimit(kind: StoredFileMeta["kind"], bytes: number) {
    const maxMb = config.uploadLimitsMb[kind];
    if (bytes > maxMb * 1024 * 1024) throw new AppError(413, `${kind} 文件不能超过 ${maxMb}MB`, 413);
}

async function providerCall<T>(prefix: string, action: () => Promise<T>) {
    try {
        return await action();
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(502, `${prefix}：${providerErrorMessage(error)}`, 502);
    }
}

function providerErrorMessage(error: unknown) {
    if (!(error instanceof Error)) return "未知错误";
    return error.message.replace(/(secret|authorization|credential)[^,;\n]*/gi, "$1 已隐藏");
}
