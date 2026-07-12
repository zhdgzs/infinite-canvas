import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "../db/client.js";
import { aiChannels, userAiPreferences } from "../db/schema.js";
import { requireAuth } from "../auth/hooks.js";
import { AppError, ok } from "../lib/api-response.js";
import { now } from "../lib/time.js";

const channelPayload = z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().min(1),
    apiFormat: z.enum(["openai", "gemini"]).default("openai"),
    apiKey: z.string().optional(),
    models: z.array(z.string()).optional(),
});

const configPayload = z.object({
    channels: z.array(channelPayload).optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
});

const refreshPayload = channelPayload.pick({ name: true, baseUrl: true, apiFormat: true, apiKey: true }).partial();

export async function aiConfigRoutes(app: FastifyInstance) {
    app.get("/api/ai/config", { preHandler: requireAuth }, async (request) => {
        const channels = await db.select().from(aiChannels).where(eq(aiChannels.userId, request.auth!.user.id));
        const [prefs] = await db.select().from(userAiPreferences).where(eq(userAiPreferences.userId, request.auth!.user.id)).limit(1);
        return ok({
            channels: channels.map(maskChannel),
            preferences: prefs?.preferences || {},
        });
    });

    app.put("/api/ai/config", { preHandler: requireAuth }, async (request) => {
        const body = configPayload.parse(request.body);
        const userId = request.auth!.user.id;
        const existing = await db.select().from(aiChannels).where(eq(aiChannels.userId, userId));
        const existingById = new Map(existing.map((channel) => [channel.id, channel]));
        const keepIds = new Set<string>();
        const savedChannels = [];
        for (const channel of body.channels || []) {
            const current = channel.id ? existingById.get(channel.id) : undefined;
            if (current) {
                const [updated] = await db
                    .update(aiChannels)
                    .set({
                        name: channel.name,
                        baseUrl: channel.baseUrl,
                        apiFormat: channel.apiFormat,
                        apiKey: channel.apiKey === undefined ? current.apiKey : channel.apiKey || null,
                        models: channel.models || [],
                        updatedAt: now(),
                    })
                    .where(and(eq(aiChannels.id, current.id), eq(aiChannels.userId, userId)))
                    .returning();
                keepIds.add(updated.id);
                savedChannels.push(updated);
                continue;
            }
            const created = now();
            const [inserted] = await db
                .insert(aiChannels)
                .values({
                    id: `channel_${nanoid()}`,
                    userId,
                    name: channel.name,
                    baseUrl: channel.baseUrl,
                    apiFormat: channel.apiFormat,
                    apiKey: channel.apiKey || null,
                    models: channel.models || [],
                    createdAt: created,
                    updatedAt: created,
                })
                .returning();
            keepIds.add(inserted.id);
            savedChannels.push(inserted);
        }
        for (const channel of existing) {
            if (!keepIds.has(channel.id)) await db.delete(aiChannels).where(and(eq(aiChannels.id, channel.id), eq(aiChannels.userId, userId)));
        }
        if (body.preferences) {
            await db
                .insert(userAiPreferences)
                .values({ userId, preferences: body.preferences, updatedAt: now() })
                .onConflictDoUpdate({ target: userAiPreferences.userId, set: { preferences: body.preferences, updatedAt: now() } });
        }
        const [prefs] = await db.select().from(userAiPreferences).where(eq(userAiPreferences.userId, userId)).limit(1);
        return ok({ channels: savedChannels.map(maskChannel), preferences: prefs?.preferences || {} });
    });

    app.put("/api/ai/preferences", { preHandler: requireAuth }, async (request) => {
        const preferences = z.record(z.string(), z.unknown()).parse(request.body);
        const [row] = await db
            .insert(userAiPreferences)
            .values({ userId: request.auth!.user.id, preferences, updatedAt: now() })
            .onConflictDoUpdate({ target: userAiPreferences.userId, set: { preferences, updatedAt: now() } })
            .returning();
        return ok(row);
    });

    app.post("/api/ai/channels", { preHandler: requireAuth }, async (request) => {
        const body = channelPayload.parse(request.body);
        const created = now();
        const [channel] = await db
            .insert(aiChannels)
            .values({
                id: `channel_${nanoid()}`,
                userId: request.auth!.user.id,
                name: body.name,
                baseUrl: body.baseUrl,
                apiFormat: body.apiFormat,
                apiKey: body.apiKey || null,
                models: body.models || [],
                createdAt: created,
                updatedAt: created,
            })
            .returning();
        return ok(maskChannel(channel));
    });

    app.put("/api/ai/channels/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await findChannel(id, request.auth!.user.id);
        const body = channelPayload.partial().parse(request.body);
        const patch: Partial<typeof aiChannels.$inferInsert> = { updatedAt: now() };
        if (body.name !== undefined) patch.name = body.name;
        if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl;
        if (body.apiFormat !== undefined) patch.apiFormat = body.apiFormat;
        if (body.models !== undefined) patch.models = body.models;
        if (body.apiKey !== undefined) patch.apiKey = body.apiKey || null;
        const [channel] = await db.update(aiChannels).set(patch).where(and(eq(aiChannels.id, id), eq(aiChannels.userId, request.auth!.user.id))).returning();
        return ok(maskChannel(channel));
    });

    app.delete("/api/ai/channels/:id", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        await db.delete(aiChannels).where(and(eq(aiChannels.id, id), eq(aiChannels.userId, request.auth!.user.id)));
        return ok({});
    });

    app.post("/api/ai/channels/:id/models/refresh", { preHandler: requireAuth }, async (request) => {
        const id = String((request.params as { id?: string }).id || "");
        const saved = id.startsWith("channel_") ? await findChannel(id, request.auth!.user.id) : undefined;
        const draft = refreshPayload.parse(request.body || {});
        const channel = {
            ...(saved || { id, userId: request.auth!.user.id, models: [], createdAt: now(), updatedAt: now() }),
            name: draft.name || saved?.name || "未保存渠道",
            baseUrl: draft.baseUrl || saved?.baseUrl || "",
            apiFormat: draft.apiFormat || saved?.apiFormat || "openai",
            apiKey: draft.apiKey?.trim() || saved?.apiKey || null,
        } as typeof aiChannels.$inferSelect;
        return ok({ ...maskChannel(channel), models: await fetchModels(channel) });
    });
}

async function findChannel(id: string, userId: string) {
    const [channel] = await db.select().from(aiChannels).where(and(eq(aiChannels.id, id), eq(aiChannels.userId, userId))).limit(1);
    if (!channel) throw new AppError(404, "AI 渠道不存在", 404);
    return channel;
}

function maskChannel(channel: typeof aiChannels.$inferSelect) {
    return {
        ...channel,
        apiKey: undefined,
        hasApiKey: Boolean(channel.apiKey),
        apiKeyMasked: channel.apiKey ? maskApiKey(channel.apiKey) : "",
    };
}

function maskApiKey(value: string) {
    if (value.length <= 8) return "****";
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

async function fetchModels(channel: typeof aiChannels.$inferSelect) {
    if (!channel.apiKey) throw new AppError(400, "请先配置 API Key", 400);
    try {
        if (channel.apiFormat === "gemini") return await fetchGeminiModels(channel);
        return await fetchOpenAiModels(channel);
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(502, `读取模型列表失败：${requestErrorMessage(error)}`, 502);
    }
}

async function fetchOpenAiModels(channel: typeof aiChannels.$inferSelect) {
    const response = await fetch(buildApiUrl(channel.baseUrl, "/models"), {
        headers: { Authorization: `Bearer ${channel.apiKey}` },
    });
    if (!response.ok) throw new AppError(502, "读取模型列表失败", 502);
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return (data.data || []).map((item) => item.id).filter((item): item is string => Boolean(item));
}

async function fetchGeminiModels(channel: typeof aiChannels.$inferSelect) {
    const response = await fetch(`${channel.baseUrl.replace(/\/+$/, "")}/v1beta/models`, {
        headers: { "x-goog-api-key": channel.apiKey || "" },
    });
    if (!response.ok) throw new AppError(502, "读取 Gemini 模型列表失败", 502);
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    return (data.models || []).map((item) => item.name?.replace(/^models\//, "")).filter((item): item is string => Boolean(item));
}

function buildApiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    const apiBase = lower.endsWith("/v1") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3") ? normalized : `${normalized}/v1`;
    return `${apiBase}${path}`;
}

function requestErrorMessage(error: unknown) {
    if (!(error instanceof Error)) return "未知错误";
    return error.cause instanceof Error ? error.cause.message : error.message;
}
