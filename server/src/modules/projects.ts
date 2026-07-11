import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, ilike, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../db/client.js";
import { canvasProjects } from "../db/schema.js";
import { requireAuth } from "../auth/hooks.js";
import { AppError, ok } from "../lib/api-response.js";
import { now } from "../lib/time.js";
import { pagination, queryString } from "../lib/pagination.js";

const projectPayload = z.object({
    title: z.string().trim().min(1).max(120).optional(),
    data: z.unknown().optional(),
});

export async function projectRoutes(app: FastifyInstance) {
    app.get("/api/projects", { preHandler: requireAuth }, async (request) => {
        const { page, pageSize, offset } = pagination(request.query);
        const keyword = queryString(request.query, "keyword");
        const filters = [eq(canvasProjects.userId, request.auth!.user.id), isNull(canvasProjects.deletedAt)];
        if (keyword) filters.push(ilike(canvasProjects.title, `%${keyword}%`));
        const where = and(...filters);
        const [total] = await db.select({ value: count() }).from(canvasProjects).where(where);
        const items = await db
            .select({
                id: canvasProjects.id,
                title: canvasProjects.title,
                version: canvasProjects.version,
                createdAt: canvasProjects.createdAt,
                updatedAt: canvasProjects.updatedAt,
            })
            .from(canvasProjects)
            .where(where)
            .orderBy(desc(canvasProjects.updatedAt))
            .limit(pageSize)
            .offset(offset);
        return ok({ items, total: Number(total?.value || 0), page, pageSize });
    });

    app.post("/api/projects", { preHandler: requireAuth }, async (request) => {
        const body = projectPayload.parse(request.body);
        const created = now();
        const [project] = await db
            .insert(canvasProjects)
            .values({
                id: `project_${nanoid()}`,
                userId: request.auth!.user.id,
                title: body.title || "未命名画布",
                data: body.data || defaultProjectData(),
                createdAt: created,
                updatedAt: created,
            })
            .returning();
        return ok(project);
    });

    app.get("/api/projects/:id", { preHandler: requireAuth }, async (request) => {
        return ok(await findProject(String((request.params as { id?: string }).id || ""), request.auth!.user.id));
    });

    app.put("/api/projects/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await findProject(id, request.auth!.user.id);
        const body = projectPayload.parse(request.body);
        const patch: Partial<typeof canvasProjects.$inferInsert> = { updatedAt: now() };
        if (body.title !== undefined) patch.title = body.title;
        if (body.data !== undefined) patch.data = body.data;
        const [project] = await db
            .update(canvasProjects)
            .set(patch)
            .where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, request.auth!.user.id)))
            .returning();
        return ok(project);
    });

    app.delete("/api/projects/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await findProject(id, request.auth!.user.id);
        await db.update(canvasProjects).set({ deletedAt: now(), updatedAt: now() }).where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, request.auth!.user.id)));
        return ok({});
    });
}

async function findProject(id: string, userId: string) {
    const [project] = await db.select().from(canvasProjects).where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, userId), isNull(canvasProjects.deletedAt))).limit(1);
    if (!project) throw new AppError(404, "画布不存在", 404);
    return project;
}

function defaultProjectData() {
    return {
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}
