import { createHash, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

import { config } from "../config.js";

export const SESSION_COOKIE_NAME = "ic_session";
const FILE_TOKEN_VERSION = "v1";

export function createSessionToken() {
    return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

export function signFileAccessToken(storageKey: string, expiresAt: Date) {
    const payload = Buffer.from(JSON.stringify({ storageKey, exp: expiresAt.getTime(), v: FILE_TOKEN_VERSION })).toString("base64url");
    const signature = createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

export function verifyFileAccessToken(token: string, storageKey: string) {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    const expected = createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
    if (!timingSafeEqualText(signature, expected)) return false;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { storageKey?: string; exp?: number; v?: string };
        return data.v === FILE_TOKEN_VERSION && data.storageKey === storageKey && typeof data.exp === "number" && data.exp > Date.now();
    } catch {
        return false;
    }
}

function timingSafeEqualText(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
