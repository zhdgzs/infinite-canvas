import type { FastifyInstance } from "fastify";
import { count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { requireAdmin } from "../auth/hooks.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { files, generationTasks, storageBackends } from "../db/schema.js";
import { AppError, ok } from "../lib/api-response.js";
import { now } from "../lib/time.js";
import { debugS3Backend, storageBackendById, type StorageBackend } from "../files/storage.js";

const s3Payload = z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "请填写后端名称").max(80),
    endpoint: z.string().trim().min(1, "请填写 Endpoint"),
    publicEndpoint: z.string().trim().optional().default(""),
    region: z.string().trim().optional().default("us-east-1"),
    bucket: z.string().trim().min(1, "请填写 Bucket"),
    accessKeyId: z.string().trim().min(1, "请填写 Access Key"),
    secretAccessKey: z.string().optional(),
    objectPrefix: z.string().trim().optional().default(""),
    forcePathStyle: z.boolean().optional().default(false),
});

const updatePayload = z.object({
    activeBackendId: z.string().min(1),
    backends: z.array(s3Payload),
    deleteIds: z.array(z.string()).optional().default([]),
});

const debugPayload = s3Payload;

export async function storageConfigRoutes(app: FastifyInstance) {
    app.get("/api/storage/config", { preHandler: requireAdmin }, async () => ok(await readStorageConfig()));

    app.put("/api/storage/config", { preHandler: requireAdmin }, async (request) => {
        const body = updatePayload.parse(request.body);
        await db.transaction(async (tx) => {
            const existing = await tx.select().from(storageBackends);
            const existingById = new Map(existing.map((item) => [item.id, item]));
            const savedIds = new Set(["local"]);
            for (const draft of body.backends) {
                const current = draft.id ? existingById.get(draft.id) : undefined;
                if (current?.type === "local") throw new AppError(400, "本地存储后端不可编辑", 400);
                if (current) {
                    const [fileRefs] = await tx.select({ value: count() }).from(files).where(eq(files.storageBackendId, current.id));
                    const [taskRefs] = await tx.select({ value: count() }).from(generationTasks).where(eq(generationTasks.storageBackendId, current.id));
                    const referenced = Number(fileRefs?.value || 0) + Number(taskRefs?.value || 0);
                    if (referenced && (current.bucket !== draft.bucket || current.objectPrefix !== draft.objectPrefix)) throw new AppError(409, `后端“${current.name}”已有文件，不能修改 Bucket 或对象前缀`, 409);
                    await tx.update(storageBackends).set(toBackendPatch(draft, current)).where(eq(storageBackends.id, current.id));
                    savedIds.add(current.id);
                } else {
                    if (!draft.secretAccessKey?.trim()) throw new AppError(400, `后端“${draft.name}”需要填写 Secret Key`, 400);
                    const id = `s3_${nanoid()}`;
                    await tx.insert(storageBackends).values({ id, type: "s3", isActive: false, createdAt: now(), ...toBackendPatch(draft) });
                    savedIds.add(id);
                }
            }
            for (const id of body.deleteIds) {
                if (id === "local" || savedIds.has(id)) continue;
                const [fileRefs] = await tx.select({ value: count() }).from(files).where(eq(files.storageBackendId, id));
                const [taskRefs] = await tx.select({ value: count() }).from(generationTasks).where(eq(generationTasks.storageBackendId, id));
                if (Number(fileRefs?.value || 0) + Number(taskRefs?.value || 0)) throw new AppError(409, "有关联文件或生成任务的存储后端不能删除", 409);
                await tx.delete(storageBackends).where(eq(storageBackends.id, id));
            }
            const activeExists = body.activeBackendId === "local" || savedIds.has(body.activeBackendId);
            if (!activeExists) throw new AppError(400, "选择的默认存储后端不存在", 400);
            await tx.update(storageBackends).set({ isActive: false, updatedAt: now() });
            await tx.update(storageBackends).set({ isActive: true, updatedAt: now() }).where(eq(storageBackends.id, body.activeBackendId));
        });
        return ok(await readStorageConfig());
    });

    app.post("/api/storage/debug", { preHandler: requireAdmin }, async (request) => {
        const draft = debugPayload.parse(request.body);
        const saved = draft.id?.startsWith("s3_") ? await storageBackendById(draft.id) : undefined;
        const secret = draft.secretAccessKey?.trim() || saved?.secretAccessKey;
        if (!secret) throw new AppError(400, "请填写 Secret Key", 400);
        try {
            return ok(await debugS3Backend({
                id: draft.id || "debug",
                type: "s3",
                isActive: false,
                createdAt: now(),
                updatedAt: now(),
                ...toBackendPatch({ ...draft, secretAccessKey: secret }),
            }));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(502, `S3 调试失败：${safeProviderError(error)}`, 502);
        }
    });
}

async function readStorageConfig() {
    const backends = await db.select().from(storageBackends);
    return {
        activeBackendId: backends.find((item) => item.isActive)?.id || "local",
        localUploadDir: config.uploadDir,
        backends: await Promise.all(backends.map(async (backend) => {
            const fileCount = await referencedFileCount(backend.id);
            const [taskRefs] = await db.select({ value: count() }).from(generationTasks).where(eq(generationTasks.storageBackendId, backend.id));
            return { ...maskBackend(backend), fileCount, isIdentityLocked: fileCount + Number(taskRefs?.value || 0) > 0 };
        })),
    };
}

function toBackendPatch(draft: z.infer<typeof s3Payload>, current?: StorageBackend) {
    return {
        name: draft.name,
        endpoint: draft.endpoint,
        publicEndpoint: draft.publicEndpoint || null,
        region: draft.region || "us-east-1",
        bucket: draft.bucket,
        accessKeyId: draft.accessKeyId,
        secretAccessKey: draft.secretAccessKey?.trim() || current?.secretAccessKey || null,
        objectPrefix: draft.objectPrefix,
        forcePathStyle: draft.forcePathStyle,
        updatedAt: now(),
    };
}

async function referencedFileCount(backendId: string) {
    const [row] = await db.select({ value: count() }).from(files).where(eq(files.storageBackendId, backendId));
    return Number(row?.value || 0);
}

function maskBackend(backend: StorageBackend) {
    return {
        ...backend,
        secretAccessKey: undefined,
        hasSecretAccessKey: Boolean(backend.secretAccessKey),
        secretAccessKeyMasked: backend.secretAccessKey ? maskSecret(backend.secretAccessKey) : "",
    };
}

function maskSecret(value: string) {
    if (value.length <= 8) return "****";
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function safeProviderError(error: unknown) {
    if (!(error instanceof Error)) return "未知错误";
    return error.message.replace(/(secret|authorization|credential)[^,;\n]*/gi, "$1 已隐藏");
}
