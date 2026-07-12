import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";

import { config } from "../config.js";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { AppError } from "../lib/api-response.js";
import { addDays, now } from "../lib/time.js";
import { hashToken, SESSION_COOKIE_NAME } from "./session.js";

const SESSION_DAYS = 30;
const ROLLING_RENEW_DAYS = 15;

export async function attachAuth(request: FastifyRequest) {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return;
    const tokenHash = hashToken(token);
    const [row] = await db
        .select({
            sessionId: sessions.id,
            expiresAt: sessions.expiresAt,
            userId: users.id,
            username: users.username,
            role: users.role,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now())))
        .limit(1);
    if (!row) return;
    request.auth = {
        sessionId: row.sessionId,
        user: { id: row.userId, username: row.username, role: row.role },
    };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    await attachAuth(request);
    if (!request.auth) throw new AppError(401, "未登录或会话已过期", 401);
    const nextExpiry = addDays(now(), SESSION_DAYS);
    await db.update(sessions).set({ lastSeenAt: now(), expiresAt: nextExpiry }).where(eq(sessions.id, request.auth.sessionId));
    reply.setCookie(SESSION_COOKIE_NAME, request.cookies[SESSION_COOKIE_NAME] || "", sessionCookieOptions(nextExpiry));
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (request.auth?.user.role !== "admin") throw new AppError(403, "仅管理员可操作实例配置", 403);
}

export function sessionCookieOptions(expires: Date) {
    return {
        path: "/",
        httpOnly: true,
        sameSite: "lax" as const,
        secure: config.cookieSecure,
        expires,
    };
}

export function clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}
