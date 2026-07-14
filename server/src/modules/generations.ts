import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../db/client.js";
import { generationTasks } from "../db/schema.js";
import { activeStorageBackend } from "../files/storage.js";
import { requireAuth } from "../auth/hooks.js";
import { AppError, ok } from "../lib/api-response.js";
import { now } from "../lib/time.js";
import { pagination, queryString } from "../lib/pagination.js";

const generationPayload = z.object({
    kind: z.enum(["image", "video", "audio", "text"]),
    prompt: z.string().optional().default(""),
    channelId: z.string().optional(),
    model: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    references: z.array(z.record(z.string(), z.unknown())).optional(),
});

export async function generationRoutes(app: FastifyInstance) {
    app.get("/api/generations/records", { preHandler: requireAuth }, async (request) => {
        const { page, pageSize, offset } = pagination(request.query);
        const kind = queryString(request.query, "kind");
        const filters = [eq(generationTasks.userId, request.auth!.user.id), isNull(generationTasks.deletedAt)];
        if (kind) filters.push(eq(generationTasks.kind, kind));
        const where = and(...filters);
        const [total] = await db.select({ value: count() }).from(generationTasks).where(where);
        const items = await db.select(generationRecordFields).from(generationTasks).where(where).orderBy(desc(generationTasks.createdAt)).limit(pageSize).offset(offset);
        return ok({ items, total: Number(total?.value || 0), page, pageSize });
    });

    app.post("/api/generations/tasks", { preHandler: requireAuth }, async (request) => {
        const body = generationPayload.parse(request.body);
        const backend = await activeStorageBackend();
        const created = now();
        const [task] = await db
            .insert(generationTasks)
            .values({
                id: `task_${nanoid()}`,
                userId: request.auth!.user.id,
                storageBackendId: backend.id,
                kind: body.kind,
                status: "queued",
                prompt: body.prompt,
                channelId: body.channelId || null,
                model: body.model || null,
                config: body.config || {},
                references: body.references || [],
                result: {},
                createdAt: created,
                updatedAt: created,
            })
            .returning({ id: generationTasks.id, status: generationTasks.status });
        return ok(task);
    });

    app.get("/api/generations/tasks/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        return ok(taskStateResponse(await findTaskState(id, request.auth!.user.id)));
    });

    app.post("/api/generations/tasks/:id/cancel", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        const task = await findTaskStatus(id, request.auth!.user.id);
        if (["succeeded", "failed", "cancelled"].includes(task.status)) throw new AppError(409, "当前任务状态不能取消", 409);
        const status = task.status === "queued" ? "cancelled" : task.status;
        const [updated] = await db
            .update(generationTasks)
            .set({ status, cancelRequested: true, updatedAt: now(), completedAt: status === "cancelled" ? now() : undefined })
            .where(and(eq(generationTasks.id, id), eq(generationTasks.userId, request.auth!.user.id)))
            .returning({ id: generationTasks.id, status: generationTasks.status });
        return ok(updated);
    });

    app.delete("/api/generations/records/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        const task = await findTaskStatus(id, request.auth!.user.id);
        if (!["succeeded", "failed", "cancelled"].includes(task.status)) throw new AppError(409, "请先取消生成任务", 409);
        await db.update(generationTasks).set({ deletedAt: now(), updatedAt: now() }).where(and(eq(generationTasks.id, id), eq(generationTasks.userId, request.auth!.user.id)));
        return ok({});
    });
}

const generationRecordFields = {
    id: generationTasks.id,
    kind: generationTasks.kind,
    status: generationTasks.status,
    prompt: generationTasks.prompt,
    model: generationTasks.model,
    config: generationTasks.config,
    references: generationTasks.references,
    result: generationTasks.result,
    error: generationTasks.error,
    createdAt: generationTasks.createdAt,
    updatedAt: generationTasks.updatedAt,
    startedAt: generationTasks.startedAt,
    completedAt: generationTasks.completedAt,
};

async function findTaskState(id: string, userId: string) {
    const [task] = await db
        .select({ id: generationTasks.id, status: generationTasks.status, result: generationTasks.result, error: generationTasks.error })
        .from(generationTasks)
        .where(and(eq(generationTasks.id, id), eq(generationTasks.userId, userId), isNull(generationTasks.deletedAt)))
        .limit(1);
    if (!task) throw new AppError(404, "生成任务不存在", 404);
    return task;
}

async function findTaskStatus(id: string, userId: string) {
    const [task] = await db
        .select({ id: generationTasks.id, status: generationTasks.status })
        .from(generationTasks)
        .where(and(eq(generationTasks.id, id), eq(generationTasks.userId, userId), isNull(generationTasks.deletedAt)))
        .limit(1);
    if (!task) throw new AppError(404, "生成任务不存在", 404);
    return task;
}

function taskStateResponse(task: Awaited<ReturnType<typeof findTaskState>>) {
    if (task.status === "succeeded") return { id: task.id, status: task.status, result: task.result };
    if (task.status === "failed" || task.status === "cancelled") return { id: task.id, status: task.status, error: task.error };
    return { id: task.id, status: task.status };
}
