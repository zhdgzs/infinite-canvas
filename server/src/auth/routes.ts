import type { FastifyInstance, FastifyReply } from "fastify";
import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { config } from "../config.js";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { AppError, ok } from "../lib/api-response.js";
import { addDays, now } from "../lib/time.js";
import { assertPassword, hashPassword, verifyPassword } from "./password.js";
import { clearSessionCookie, requireAuth, sessionCookieOptions } from "./hooks.js";
import { createSessionToken, hashToken, SESSION_COOKIE_NAME } from "./session.js";

const credentialsSchema = z.object({
    username: z.string().trim().min(1, "请输入用户名").max(64, "用户名过长"),
    password: z.string().min(8, "密码至少需要 8 位").max(256, "密码过长"),
});

export async function authRoutes(app: FastifyInstance) {
    app.get("/api/setup/status", async () => {
        const initialized = await hasAnyUser();
        return ok({ initialized });
    });

    app.post("/api/setup/register", async (request, reply) => {
        if (await hasAnyUser()) throw new AppError(409, "系统已经初始化", 409);
        const body = credentialsSchema.parse(request.body);
        assertPassword(body.password);
        const [user] = await db
            .insert(users)
            .values({ username: body.username, passwordHash: await hashPassword(body.password), role: "admin", createdAt: now(), updatedAt: now() })
            .returning({ id: users.id, username: users.username, role: users.role });
        await createLoginSession(reply, user.id);
        return ok({ user });
    });

    app.post("/api/auth/login", async (request, reply) => {
        const body = credentialsSchema.parse(request.body);
        const [user] = await db.select().from(users).where(eq(users.username, body.username)).limit(1);
        if (!user || !(await verifyPassword(user.passwordHash, body.password))) throw new AppError(401, "用户名或密码错误", 401);
        await createLoginSession(reply, user.id);
        return ok({ user: { id: user.id, username: user.username, role: user.role } });
    });

    app.post("/api/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
        if (request.auth) await db.delete(sessions).where(eq(sessions.id, request.auth.sessionId));
        clearSessionCookie(reply);
        return ok({});
    });

    app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
        return ok({ user: request.auth?.user || null });
    });
}

async function hasAnyUser() {
    const [row] = await db.select({ value: count() }).from(users);
    return Number(row?.value || 0) > 0;
}

async function createLoginSession(reply: FastifyReply, userId: string) {
    const token = createSessionToken();
    const expiresAt = addDays(now(), 30);
    await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, createdAt: now(), lastSeenAt: now() });
    reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}
