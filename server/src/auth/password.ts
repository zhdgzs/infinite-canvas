import argon2 from "argon2";

export function hashPassword(password: string) {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
    });
}

export function verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
}

export function assertPassword(password: string) {
    if (password.length < 8) throw new Error("密码至少需要 8 位");
}
