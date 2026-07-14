import { assertRuntimeConfig, config } from "./config.js";
import { buildApp } from "./app.js";
import { closeDb } from "./db/client.js";
import { startGenerationWorker } from "./modules/worker.js";

async function main() {
    assertRuntimeConfig();
    const app = await buildApp();
    const worker = startGenerationWorker(app.log);
    const shutdown = async () => {
        await worker.stop();
        await app.close();
        await closeDb();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
    await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
