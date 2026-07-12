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
    app.get("/api/generations", { preHandler: requireAuth }, async (request) => {
        const { page, pageSize, offset } = pagination(request.query);
        const kind = queryString(request.query, "kind");
        const filters = [eq(generationTasks.userId, request.auth!.user.id), isNull(generationTasks.deletedAt)];
        if (kind) filters.push(eq(generationTasks.kind, kind));
        const where = and(...filters);
        const [total] = await db.select({ value: count() }).from(generationTasks).where(where);
        const items = await db.select().from(generationTasks).where(where).orderBy(desc(generationTasks.createdAt)).limit(pageSize).offset(offset);
        return ok({ items, total: Number(total?.value || 0), page, pageSize });
    });

    app.post("/api/generations", { preHandler: requireAuth }, async (request) => {
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
            .returning();
        return ok(task);
    });

    app.get("/api/generations/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        return ok(await findTask(id, request.auth!.user.id));
    });

    app.post("/api/generations/:id/cancel", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        const task = await findTask(id, request.auth!.user.id);
        if (["succeeded", "failed", "cancelled"].includes(task.status)) throw new AppError(409, "当前任务状态不能取消", 409);
        const status = task.status === "queued" ? "cancelled" : task.status;
        const [updated] = await db
            .update(generationTasks)
            .set({ status, cancelRequested: true, updatedAt: now(), completedAt: status === "cancelled" ? now() : undefined })
            .where(and(eq(generationTasks.id, id), eq(generationTasks.userId, request.auth!.user.id)))
            .returning();
        return ok(updated);
    });

    app.delete("/api/generations/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await findTask(id, request.auth!.user.id);
        await db.update(generationTasks).set({ deletedAt: now(), updatedAt: now() }).where(and(eq(generationTasks.id, id), eq(generationTasks.userId, request.auth!.user.id)));
        return ok({});
    });
}

async function findTask(id: string, userId: string) {
    const [task] = await db.select().from(generationTasks).where(and(eq(generationTasks.id, id), eq(generationTasks.userId, userId), isNull(generationTasks.deletedAt))).limit(1);
    if (!task) throw new AppError(404, "生成任务不存在", 404);
    return task;
}
