import { createReadStream } from "node:fs";
import { copyFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { config } from "../config.js";

export function absoluteUploadPath(relativePath: string) {
    return join(config.uploadDir, relativePath);
}

export async function fileStat(relativePath: string) {
    return stat(absoluteUploadPath(relativePath));
}

export function fileStream(relativePath: string, options?: { start?: number; end?: number }) {
    return createReadStream(absoluteUploadPath(relativePath), options);
}

export async function moveTempFile(tempPath: string, finalPath: string) {
    try {
        await rename(tempPath, finalPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await copyFile(tempPath, finalPath);
        await rm(tempPath, { force: true });
    }
}
