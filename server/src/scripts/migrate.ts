import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { config } from "../config.js";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = resolve(serverDir, "drizzle");

async function migrate() {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    const client = await pool.connect();
    try {
        await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
        for (const file of files) {
            const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
            if (applied.rowCount) continue;
            const sql = await readFile(resolve(migrationsDir, file), "utf8");
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
                await client.query("COMMIT");
                console.log(`applied migration ${file}`);
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((error) => {
    console.error(error);
    process.exit(1);
});
