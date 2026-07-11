import type { FastifyReply } from "fastify";

export type ApiEnvelope<T> = {
    code: number;
    msg: string;
    data: T;
};

export class AppError extends Error {
    code: number;
    statusCode: number;

    constructor(code: number, message: string, statusCode = code >= 400 && code < 600 ? code : 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

export function ok<T>(data: T, msg = ""): ApiEnvelope<T> {
    return { code: 200, msg, data };
}

export function fail(reply: FastifyReply, code: number, msg: string, statusCode = code >= 400 && code < 600 ? code : 400) {
    return reply.status(statusCode).send({ code, msg, data: {} });
}
