import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";

import { config } from "../config.js";
import { db } from "../db/client.js";
import { files } from "../db/schema.js";
import { AppError, ok } from "../lib/api-response.js";
import { now } from "../lib/time.js";
import { attachAuth, requireAuth } from "../auth/hooks.js";
import { signFileAccessToken, verifyFileAccessToken } from "../auth/session.js";
import { fileStat, fileStream } from "./local-storage.js";
import { activeStorageBackend, s3AccessUrl, storageBackendById, storeMultipartFile } from "./storage.js";

export async function fileRoutes(app: FastifyInstance) {
    app.post("/api/files", { preHandler: requireAuth }, async (request) => {
        const upload = await request.file();
        if (!upload) throw new AppError(400, "请选择文件", 400);
        const backend = await activeStorageBackend();
        const meta = await storeMultipartFile(request.auth!.user.id, backend, upload);
        await db.insert(files).values({
            storageKey: meta.storageKey,
            userId: request.auth!.user.id,
            storageBackendId: meta.storageBackendId,
            kind: meta.kind,
            path: meta.path,
            originalName: meta.originalName,
            mimeType: meta.mimeType,
            bytes: meta.bytes,
            width: meta.width,
            height: meta.height,
            durationMs: meta.durationMs,
            sha256: meta.sha256,
            createdAt: now(),
        });
        return ok(meta);
    });

    app.get("/api/files/:storageKey/access-url", { preHandler: requireAuth }, async (request) => {
        const storageKey = readStorageKey(request);
        const file = await findOwnedFile(storageKey, request.auth!.user.id);
        const expiresAt = new Date(Date.now() + config.fileAccessUrlTtlSeconds * 1000);
        const backend = await storageBackendById(file.storageBackendId);
        if (backend.type === "s3") {
            return ok({
                url: await s3AccessUrl(backend, file.path, config.fileAccessUrlTtlSeconds),
                expiresAt: expiresAt.toISOString(),
                mimeType: file.mimeType,
                bytes: file.bytes,
            });
        }
        const token = signFileAccessToken(storageKey, expiresAt);
        return ok({
            url: `/api/files/${encodeURIComponent(storageKey)}/content?token=${encodeURIComponent(token)}`,
            expiresAt: expiresAt.toISOString(),
            mimeType: file.mimeType,
            bytes: file.bytes,
        });
    });

    app.get("/api/files/:storageKey/content", async (request, reply) => {
        const storageKey = readStorageKey(request);
        const token = typeof request.query === "object" && request.query && "token" in request.query ? String((request.query as { token?: string }).token || "") : "";
        const tokenValid = token ? verifyFileAccessToken(token, storageKey) : false;
        if (!tokenValid) await attachAuth(request);
        if (!tokenValid && !request.auth) throw new AppError(401, "未登录或文件链接已过期", 401);

        const file = tokenValid ? await findFile(storageKey) : await findOwnedFile(storageKey, request.auth!.user.id);
        const backend = await storageBackendById(file.storageBackendId);
        if (backend.type !== "local") throw new AppError(400, "S3 文件不能通过本地内容接口读取", 400);
        await sendFileContent(request, reply, file);
    });

    app.delete("/api/files/:storageKey", { preHandler: requireAuth }, async (request) => {
        const storageKey = readStorageKey(request);
        await findOwnedFile(storageKey, request.auth!.user.id);
        await db.update(files).set({ deletedAt: now() }).where(and(eq(files.storageKey, storageKey), eq(files.userId, request.auth!.user.id)));
        return ok({});
    });
}

async function sendFileContent(request: FastifyRequest, reply: FastifyReply, file: typeof files.$inferSelect) {
    const stat = await fileStat(file.path);
    const etag = `"${file.sha256 || `${file.storageKey}-${stat.size}`}"`;
    const disposition = `inline; filename*=UTF-8''${encodeURIComponent(file.originalName || `${file.storageKey}.${file.mimeType.split("/")[1] || "bin"}`)}`;
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", file.mimeType);
    reply.header("ETag", etag);
    reply.header("Last-Modified", stat.mtime.toUTCString());
    reply.header("Content-Disposition", disposition);

    const range = request.headers.range;
    if (!range) {
        reply.header("Content-Length", stat.size);
        return reply.send(fileStream(file.path));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) throw new AppError(416, "Range 请求不合法", 416);
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= stat.size) throw new AppError(416, "Range 超出文件范围", 416);
    reply.status(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    reply.header("Content-Length", end - start + 1);
    return reply.send(fileStream(file.path, { start, end }));
}

async function findOwnedFile(storageKey: string, userId: string) {
    const [file] = await db.select().from(files).where(and(eq(files.storageKey, storageKey), eq(files.userId, userId), isNull(files.deletedAt))).limit(1);
    if (!file) throw new AppError(404, "文件不存在", 404);
    return file;
}

async function findFile(storageKey: string) {
    const [file] = await db.select().from(files).where(and(eq(files.storageKey, storageKey), isNull(files.deletedAt))).limit(1);
    if (!file) throw new AppError(404, "文件不存在", 404);
    return file;
}

function readStorageKey(request: FastifyRequest) {
    return String((request.params as { storageKey?: string }).storageKey || "");
}
