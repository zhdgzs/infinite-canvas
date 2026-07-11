import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, ilike, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../db/client.js";
import { assets } from "../db/schema.js";
import { requireAuth } from "../auth/hooks.js";
import { AppError, ok } from "../lib/api-response.js";
import { now } from "../lib/time.js";
import { pagination, queryString } from "../lib/pagination.js";

const assetPayload = z.object({
    kind: z.enum(["text", "image", "video", "audio"]),
    title: z.string().trim().min(1).max(120),
    tags: z.array(z.string()).optional(),
    coverStorageKey: z.string().optional().nullable(),
    coverUrl: z.string().optional().nullable(),
    data: z.unknown(),
    metadata: z.unknown().optional().nullable(),
});

export async function assetRoutes(app: FastifyInstance) {
    app.get("/api/assets", { preHandler: requireAuth }, async (request) => {
        const { page, pageSize, offset } = pagination(request.query);
        const keyword = queryString(request.query, "keyword");
        const kind = queryString(request.query, "kind");
        const filters = [eq(assets.userId, request.auth!.user.id), isNull(assets.deletedAt)];
        if (keyword) filters.push(ilike(assets.title, `%${keyword}%`));
        if (kind) filters.push(eq(assets.kind, kind));
        const where = and(...filters);
        const [total] = await db.select({ value: count() }).from(assets).where(where);
        const items = await db.select().from(assets).where(where).orderBy(desc(assets.updatedAt)).limit(pageSize).offset(offset);
        return ok({ items, total: Number(total?.value || 0), page, pageSize });
    });

    app.post("/api/assets", { preHandler: requireAuth }, async (request) => {
        const body = assetPayload.parse(request.body);
        const created = now();
        const [asset] = await db
            .insert(assets)
            .values({
                id: `asset_${nanoid()}`,
                userId: request.auth!.user.id,
                kind: body.kind,
                title: body.title,
                tags: body.tags || [],
                coverStorageKey: body.coverStorageKey || null,
                coverUrl: body.coverUrl || null,
                data: body.data,
                metadata: body.metadata || null,
                createdAt: created,
                updatedAt: created,
            })
            .returning();
        return ok(asset);
    });

    app.put("/api/assets/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await findAsset(id, request.auth!.user.id);
        const body = assetPayload.partial().parse(request.body);
        const [asset] = await db
            .update(assets)
            .set({ ...body, updatedAt: now() })
            .where(and(eq(assets.id, id), eq(assets.userId, request.auth!.user.id)))
            .returning();
        return ok(asset);
    });

    app.delete("/api/assets/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await findAsset(id, request.auth!.user.id);
        await db.update(assets).set({ deletedAt: now(), updatedAt: now() }).where(and(eq(assets.id, id), eq(assets.userId, request.auth!.user.id)));
        return ok({});
    });
}

async function findAsset(id: string, userId: string) {
    const [asset] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt))).limit(1);
    if (!asset) throw new AppError(404, "素材不存在", 404);
    return asset;
}
