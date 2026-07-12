import { existsSync } from "node:fs";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";

import { config } from "./config.js";
import { AppError, fail, ok } from "./lib/api-response.js";
import { authRoutes } from "./auth/routes.js";
import { fileRoutes } from "./files/routes.js";
import { projectRoutes } from "./modules/projects.js";
import { assetRoutes } from "./modules/assets.js";
import { aiConfigRoutes } from "./modules/ai-config.js";
import { generationRoutes } from "./modules/generations.js";
import { storageConfigRoutes } from "./modules/storage-config.js";

export async function buildApp() {
    const app = Fastify({
        logger: true,
        bodyLimit: config.uploadLimitsMb.file * 1024 * 1024,
    });

    app.register(cookie, { secret: config.sessionSecret });
    app.register(multipart, {
        limits: {
            files: 1,
            fileSize: config.uploadLimitsMb.file * 1024 * 1024,
        },
    });

    app.setErrorHandler((error, _request, reply) => {
        if (error instanceof AppError) return fail(reply, error.code, error.message, error.statusCode);
        if (error instanceof ZodError) return fail(reply, 400, error.issues[0]?.message || "参数错误", 400);
        if (hasStatusCode(error) && error.statusCode === 413) return fail(reply, 413, "文件过大", 413);
        app.log.error(error);
        return fail(reply, 500, "服务端错误", 500);
    });

    app.get("/api/health", async () => ok({ status: "ok" }));

    await app.register(authRoutes);
    await app.register(fileRoutes);
    await app.register(projectRoutes);
    await app.register(assetRoutes);
    await app.register(aiConfigRoutes);
    await app.register(generationRoutes);
    await app.register(storageConfigRoutes);

    if (existsSync(config.webDistDir)) {
        await app.register(fastifyStatic, {
            root: config.webDistDir,
            prefix: "/",
            wildcard: false,
        });
    }

    app.setNotFoundHandler((request, reply) => {
        if (request.raw.url?.startsWith("/api/")) return fail(reply, 404, "接口不存在", 404);
        if (!existsSync(config.webDistDir)) return fail(reply, 404, "前端构建产物不存在", 404);
        return reply.sendFile("index.html", config.webDistDir);
    });

    return app;
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
    return Boolean(error && typeof error === "object" && "statusCode" in error);
}
