import type { FastifyRequest } from "fastify";

export type AuthUser = {
    id: string;
    username: string;
    role: string;
};

export type AuthContext = {
    user: AuthUser;
    sessionId: string;
};

declare module "fastify" {
    interface FastifyRequest {
        auth?: AuthContext;
    }
}

export function requireAuthContext(request: FastifyRequest) {
    if (!request.auth) throw new Error("未登录或会话已过期");
    return request.auth;
}
