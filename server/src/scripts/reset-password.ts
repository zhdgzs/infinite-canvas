import { eq } from "drizzle-orm";

import { db, closeDb } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { assertPassword, hashPassword } from "../auth/password.js";
import { now } from "../lib/time.js";

function arg(name: string) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
    const username = arg("username");
    const password = arg("password");
    if (!username || !password) throw new Error("用法：npm run admin:reset-password -- --username admin --password new-password");
    assertPassword(password);
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) throw new Error(`用户不存在：${username}`);
    await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: now() }).where(eq(users.id, user.id));
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    console.log(`已重置 ${username} 的密码，并清理旧 session`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        void closeDb();
    });
