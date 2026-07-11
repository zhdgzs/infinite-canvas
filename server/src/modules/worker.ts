import { readFile } from "node:fs/promises";
import { and, asc, eq, isNull } from "drizzle-orm";

import { config } from "../config.js";
import { db } from "../db/client.js";
import { aiChannels, files, generationTasks } from "../db/schema.js";
import { absoluteUploadPath, storeBufferFile } from "../files/local-storage.js";
import type { StoredFileMeta } from "../files/types.js";
import { now } from "../lib/time.js";

type GenerationTask = typeof generationTasks.$inferSelect;
type AiChannel = typeof aiChannels.$inferSelect;
type TaskKind = "image" | "video" | "audio" | "text";
type Reference = Record<string, unknown>;
type RunResult = { result: Record<string, unknown>; providerTaskId?: string; providerStatus?: string };

const running = new Map<TaskKind, number>([
    ["image", 0],
    ["audio", 0],
    ["video", 0],
    ["text", 0],
]);

export function startGenerationWorker() {
    const tick = () => void runWorkerTick().catch((error) => console.error("generation worker error", error));
    const timer = setInterval(tick, 1500);
    tick();
    return {
        stop: async () => clearInterval(timer),
    };
}

async function runWorkerTick() {
    await Promise.all((["image", "audio", "video", "text"] as const).map((kind) => startQueuedTasks(kind)));
}

async function startQueuedTasks(kind: TaskKind) {
    const available = concurrencyFor(kind) - (running.get(kind) || 0);
    if (available <= 0) return;
    const tasks = await db
        .select()
        .from(generationTasks)
        .where(and(eq(generationTasks.kind, kind), eq(generationTasks.status, "queued"), isNull(generationTasks.deletedAt)))
        .orderBy(asc(generationTasks.createdAt))
        .limit(available);
    for (const task of tasks) {
        running.set(kind, (running.get(kind) || 0) + 1);
        void runTask(task).finally(() => running.set(kind, Math.max(0, (running.get(kind) || 1) - 1)));
    }
}

async function runTask(task: GenerationTask) {
    const [locked] = await db
        .update(generationTasks)
        .set({ status: "running", startedAt: now(), updatedAt: now() })
        .where(and(eq(generationTasks.id, task.id), eq(generationTasks.status, "queued")))
        .returning();
    if (!locked) return;
    try {
        const latest = await getTask(task.id);
        if (!latest || latest.cancelRequested) return markCancelled(task.id);
        const result = await executeTask(latest);
        const afterRun = await getTask(task.id);
        if (!afterRun || afterRun.cancelRequested) return markCancelled(task.id);
        await db
            .update(generationTasks)
            .set({ status: "succeeded", result: result.result, providerTaskId: result.providerTaskId, providerStatus: result.providerStatus, updatedAt: now(), completedAt: now() })
            .where(eq(generationTasks.id, task.id));
    } catch (error) {
        await db
            .update(generationTasks)
            .set({ status: "failed", error: error instanceof Error ? error.message : "生成失败", updatedAt: now(), completedAt: now() })
            .where(eq(generationTasks.id, task.id));
    }
}

async function executeTask(task: GenerationTask): Promise<RunResult> {
    const channel = await resolveChannel(task);
    if (task.kind === "image") return runImageTask(task, channel);
    if (task.kind === "audio") return runAudioTask(task, channel);
    if (task.kind === "video") return runVideoTask(task, channel);
    return runTextTask(task, channel);
}

async function runImageTask(task: GenerationTask, channel: AiChannel): Promise<RunResult> {
    const taskConfig = recordConfig(task.config);
    const references = recordArray(task.references);
    const mode = stringValue(taskConfig.mode) || (references.length ? "edit" : "generation");
    const count = clampInt(taskConfig.count, 1, 15, 1);
    const images = channel.apiFormat === "gemini" ? await requestGeminiImages(task, channel, references, count) : mode === "edit" ? await requestOpenAiImageEdit(task, channel, references, count) : await requestOpenAiImages(task, channel, count);
    return { result: { images: await Promise.all(images.map((image, index) => saveGeneratedBuffer(task.userId, image.buffer, `image-${index + 1}.${image.ext || "png"}`, image.mimeType))) } };
}

async function requestOpenAiImages(task: GenerationTask, channel: AiChannel, count: number) {
    const taskConfig = recordConfig(task.config);
    const body = {
        model: task.model || firstModel(channel),
        prompt: withSystemPrompt(taskConfig, task.prompt),
        n: count,
        response_format: "b64_json",
        output_format: "png",
        ...optionalString("quality", normalizeImageQuality(taskConfig.quality)),
        ...optionalString("size", stringValue(taskConfig.size) === "auto" ? "" : stringValue(taskConfig.size)),
    };
    const payload = await fetchJson<{ data?: Array<Record<string, unknown>> }>(buildApiUrl(channel.baseUrl, "/images/generations"), { method: "POST", headers: openAiHeaders(channel), body: JSON.stringify(body) });
    return parseImageItems(payload.data || []);
}

async function requestOpenAiImageEdit(task: GenerationTask, channel: AiChannel, references: Reference[], count: number) {
    if (!references.length) return requestOpenAiImages(task, channel, count);
    const taskConfig = recordConfig(task.config);
    const form = new FormData();
    form.set("model", task.model || firstModel(channel));
    form.set("prompt", withSystemPrompt(taskConfig, task.prompt));
    form.set("n", String(count));
    form.set("response_format", "b64_json");
    form.set("output_format", "png");
    const quality = normalizeImageQuality(taskConfig.quality);
    if (quality) form.set("quality", quality);
    const size = stringValue(taskConfig.size);
    if (size && size !== "auto") form.set("size", size);
    for (const [index, reference] of references.entries()) {
        const media = await readReferenceMedia(task.userId, reference, "image/png");
        form.append("image", new Blob([media.buffer], { type: media.mimeType }), `reference-${index + 1}.${extensionForMime(media.mimeType, "png")}`);
    }
    const mask = recordValue(taskConfig.mask);
    if (Object.keys(mask).length) {
        const media = await readReferenceMedia(task.userId, mask, "image/png");
        form.append("mask", new Blob([media.buffer], { type: media.mimeType }), `mask.${extensionForMime(media.mimeType, "png")}`);
    }
    const payload = await fetchJson<{ data?: Array<Record<string, unknown>> }>(buildApiUrl(channel.baseUrl, "/images/edits"), { method: "POST", headers: authHeaders(channel), body: form });
    return parseImageItems(payload.data || []);
}

async function requestGeminiImages(task: GenerationTask, channel: AiChannel, references: Reference[], count: number) {
    if (Object.keys(recordValue(recordConfig(task.config).mask)).length) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
    const images = [];
    for (let index = 0; index < count; index += 1) {
        const parts: Array<Record<string, unknown>> = [{ text: task.prompt }];
        for (const reference of references) parts.push(await geminiImagePart(task.userId, reference));
        const payload = await fetchJson<Record<string, unknown>>(`${geminiApiUrl(channel, task.model || firstModel(channel), "generateContent")}`, {
            method: "POST",
            headers: geminiHeaders(channel),
            body: JSON.stringify({
                contents: [{ role: "user", parts }],
                generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
                ...systemInstruction(recordConfig(task.config)),
            }),
        });
        images.push(...parseGeminiImages(payload));
    }
    return images;
}

async function runAudioTask(task: GenerationTask, channel: AiChannel): Promise<RunResult> {
    if (channel.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持音频生成");
    const taskConfig = recordConfig(task.config);
    const format = normalizeAudioFormat(taskConfig.audioFormat);
    const response = await fetch(buildApiUrl(channel.baseUrl, "/audio/speech"), {
        method: "POST",
        headers: openAiHeaders(channel),
        body: JSON.stringify({
            model: task.model || firstModel(channel),
            input: task.prompt,
            voice: normalizeAudioVoice(taskConfig.audioVoice),
            response_format: format,
            speed: clampNumber(taskConfig.audioSpeed, 0.25, 4, 1),
            ...optionalString("instructions", stringValue(taskConfig.audioInstructions)),
        }),
    });
    const buffer = await readBinaryResponse(response, "音频生成失败");
    const audio = await saveGeneratedBuffer(task.userId, buffer, `audio.${format}`, audioMimeType(format));
    return { result: { audio } };
}

async function runTextTask(task: GenerationTask, channel: AiChannel): Promise<RunResult> {
    const taskConfig = recordConfig(task.config);
    const messages = recordArray(taskConfig.messages);
    const text = channel.apiFormat === "gemini" ? await requestGeminiText(task, channel, messages) : await requestOpenAiText(task, channel, messages);
    return { result: { text: text || "没有返回内容" } };
}

async function requestOpenAiText(task: GenerationTask, channel: AiChannel, messages: Reference[]) {
    const taskConfig = recordConfig(task.config);
    const payload = await fetchJson<Record<string, unknown>>(buildApiUrl(channel.baseUrl, "/responses"), {
        method: "POST",
        headers: openAiHeaders(channel),
        body: JSON.stringify({ model: task.model || firstModel(channel), input: toOpenAiInput(messages, task.prompt, taskConfig) }),
    });
    return stringValue(payload.output_text) || textFromResponseOutput(payload.output);
}

async function requestGeminiText(task: GenerationTask, channel: AiChannel, messages: Reference[]) {
    const taskConfig = recordConfig(task.config);
    const payload = await fetchJson<Record<string, unknown>>(geminiApiUrl(channel, task.model || firstModel(channel), "generateContent"), {
        method: "POST",
        headers: geminiHeaders(channel),
        body: JSON.stringify({ contents: toGeminiContents(messages, task.prompt), ...systemInstruction(taskConfig) }),
    });
    return textFromGemini(payload);
}

async function runVideoTask(task: GenerationTask, channel: AiChannel): Promise<RunResult> {
    if (channel.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成");
    const taskConfig = recordConfig(task.config);
    const model = task.model || firstModel(channel);
    const providerTask = isSeedance(channel, model) ? await createSeedanceVideoTask(task, channel, model, taskConfig) : await createOpenAiVideoTask(task, channel, model, taskConfig);
    const video = isSeedance(channel, model) ? await pollSeedanceVideo(task, channel, providerTask.id) : await pollOpenAiVideo(task, channel, providerTask.id);
    return { result: { video }, providerTaskId: providerTask.id, providerStatus: "succeeded" };
}

async function createOpenAiVideoTask(task: GenerationTask, channel: AiChannel, model: string, taskConfig: Record<string, unknown>) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", task.prompt);
    form.append("seconds", String(clampInt(taskConfig.videoSeconds, 1, 20, 6)));
    const size = normalizeVideoSize(taskConfig.size);
    if (size) form.append("size", size);
    form.append("resolution_name", normalizeVideoResolution(taskConfig.vquality));
    form.append("preset", "normal");
    for (const [index, reference] of recordArray(task.references).slice(0, 7).entries()) {
        const media = await readReferenceMedia(task.userId, reference, "image/png");
        form.append("input_reference[]", new Blob([media.buffer], { type: media.mimeType }), `reference-${index + 1}.${extensionForMime(media.mimeType, "png")}`);
    }
    const payload = await fetchJson<Record<string, unknown>>(buildApiUrl(channel.baseUrl, "/videos"), { method: "POST", headers: authHeaders(channel), body: form });
    const id = stringValue(unwrapEnvelope(payload).id);
    if (!id) throw new Error("视频接口没有返回任务 ID");
    return { id };
}

async function pollOpenAiVideo(task: GenerationTask, channel: AiChannel, providerTaskId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        await throwIfCancelled(task.id);
        const payload = unwrapEnvelope(await fetchJson<Record<string, unknown>>(buildApiUrl(channel.baseUrl, `/videos/${providerTaskId}`), { headers: authHeaders(channel) }));
        const url = videoResultUrl(payload);
        if (url) return saveVideoResult(task.userId, url);
        if (stringValue(payload.status) === "completed") {
            const response = await fetch(buildApiUrl(channel.baseUrl, `/videos/${providerTaskId}/content`), { headers: authHeaders(channel) });
            return saveGeneratedBuffer(task.userId, await readBinaryResponse(response, "视频内容下载失败"), "video.mp4", "video/mp4");
        }
        if (["failed", "cancelled"].includes(stringValue(payload.status))) throw new Error(readApiError(payload.error) || "视频生成失败");
        await delay(2500);
    }
    throw new Error("视频生成超时，请稍后重试");
}

async function createSeedanceVideoTask(task: GenerationTask, channel: AiChannel, model: string, taskConfig: Record<string, unknown>) {
    const references = recordArray(task.references);
    const payload = {
        model,
        content: [{ type: "text", text: task.prompt }, ...(await Promise.all(references.map((reference) => seedanceReferenceContent(task.userId, reference))))].filter(Boolean),
        ratio: normalizeSeedanceRatio(taskConfig.size),
        resolution: normalizeVideoResolution(taskConfig.vquality),
        duration: clampInt(taskConfig.videoSeconds, 4, 15, 5),
        generate_audio: booleanValue(taskConfig.videoGenerateAudio, true),
        watermark: booleanValue(taskConfig.videoWatermark, false),
    };
    const created = unwrapEnvelope(await fetchJson<Record<string, unknown>>(buildApiUrl(channel.baseUrl, "/contents/generations/tasks"), { method: "POST", headers: openAiHeaders(channel), body: JSON.stringify(payload) }));
    const id = stringValue(created.id);
    if (!id) throw new Error("Seedance 接口没有返回任务 ID");
    return { id };
}

async function pollSeedanceVideo(task: GenerationTask, channel: AiChannel, providerTaskId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        await throwIfCancelled(task.id);
        const payload = unwrapEnvelope(await fetchJson<Record<string, unknown>>(buildApiUrl(channel.baseUrl, `/contents/generations/tasks/${providerTaskId}`), { headers: authHeaders(channel) }));
        const url = videoResultUrl(payload);
        if (url) return saveVideoResult(task.userId, url);
        const status = stringValue(payload.status);
        if (["failed", "cancelled", "expired"].includes(status)) throw new Error(readApiError(payload.error) || "Seedance 视频生成失败");
        await delay(5000);
    }
    throw new Error("Seedance 视频生成超时，请稍后重试");
}

async function saveVideoResult(userId: string, url: string) {
    const response = await fetch(url);
    if (!response.ok) return { url, mimeType: "video/mp4" };
    return saveGeneratedBuffer(userId, await readBinaryResponse(response, "视频下载失败"), "video.mp4", response.headers.get("content-type") || "video/mp4");
}

async function saveGeneratedBuffer(userId: string, buffer: Buffer, filename: string, mimeType?: string) {
    const meta = await storeBufferFile(userId, buffer, filename, mimeType);
    await db.insert(files).values({
        storageKey: meta.storageKey,
        userId,
        kind: meta.kind,
        path: meta.path,
        originalName: meta.originalName,
        mimeType: meta.mimeType,
        bytes: meta.bytes,
        width: meta.width,
        height: meta.height,
        durationMs: meta.durationMs,
        sha256: meta.sha256,
        createdAt: now(),
    });
    return meta;
}

async function resolveChannel(task: GenerationTask) {
    const filters = [eq(aiChannels.userId, task.userId)];
    if (task.channelId) filters.push(eq(aiChannels.id, task.channelId));
    const [channel] = await db.select().from(aiChannels).where(and(...filters)).limit(1);
    if (!channel) throw new Error("AI 渠道不存在");
    if (!channel.apiKey) throw new Error("请先配置 API Key");
    if (!task.model && !firstModel(channel)) throw new Error("请先配置模型");
    return channel;
}

async function readReferenceMedia(userId: string, reference: Reference, defaultMimeType: string) {
    const storageKey = stringValue(reference.storageKey);
    if (storageKey) {
        const [file] = await db.select().from(files).where(and(eq(files.storageKey, storageKey), eq(files.userId, userId), isNull(files.deletedAt))).limit(1);
        if (!file) throw new Error("参考素材不存在");
        return { buffer: await readFile(absoluteUploadPath(file.path)), mimeType: file.mimeType };
    }
    const dataUrl = stringValue(reference.dataUrl) || stringValue(reference.url);
    if (dataUrl.startsWith("data:")) return parseDataUrl(dataUrl);
    if (/^https?:\/\//i.test(dataUrl)) {
        const response = await fetch(dataUrl);
        return { buffer: await readBinaryResponse(response, "参考素材读取失败"), mimeType: response.headers.get("content-type") || defaultMimeType };
    }
    throw new Error("参考素材缺少 storageKey");
}

async function geminiImagePart(userId: string, reference: Reference) {
    const media = await readReferenceMedia(userId, reference, "image/png");
    return { inlineData: { mimeType: media.mimeType, data: media.buffer.toString("base64") } };
}

async function seedanceReferenceContent(userId: string, reference: Reference) {
    const kind = stringValue(reference.kind) || stringValue(reference.type) || "image";
    const directUrl = stringValue(reference.url);
    const url = directUrl.startsWith("http") || directUrl.startsWith("asset://") ? directUrl : await mediaDataUrl(userId, reference, kind === "audio" ? "audio/mpeg" : kind === "video" ? "video/mp4" : "image/png");
    if (kind === "video") return { type: "video_url", video_url: { url }, role: "reference_video" };
    if (kind === "audio") return { type: "audio_url", audio_url: { url }, role: "reference_audio" };
    return { type: "image_url", image_url: { url }, role: "reference_image" };
}

async function mediaDataUrl(userId: string, reference: Reference, defaultMimeType: string) {
    const media = await readReferenceMedia(userId, reference, defaultMimeType);
    return `data:${media.mimeType};base64,${media.buffer.toString("base64")}`;
}

async function parseImageItems(items: Array<Record<string, unknown>>) {
    return Promise.all(items.map(async (item) => {
        const b64 = stringValue(item.b64_json);
        if (b64) return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png", ext: "png" };
        const url = stringValue(item.url);
        if (!url) throw new Error("接口没有返回图片");
        const response = await fetch(url);
        return { buffer: await readBinaryResponse(response, "图片下载失败"), mimeType: response.headers.get("content-type") || "image/png", ext: "png" };
    }));
}

function parseGeminiImages(payload: Record<string, unknown>) {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const images: Array<{ buffer: Buffer; mimeType: string; ext?: string }> = [];
    for (const candidate of candidates) {
        const content = recordValue(candidate).content;
        const parts = Array.isArray(recordValue(content).parts) ? (recordValue(content).parts as unknown[]) : [];
        for (const part of parts) {
            const inline = recordValue(recordValue(part).inlineData || recordValue(part).inline_data);
            const data = stringValue(inline.data);
            if (data) images.push({ buffer: Buffer.from(data, "base64"), mimeType: stringValue(inline.mimeType || inline.mime_type) || "image/png", ext: "png" });
        }
    }
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

function toOpenAiInput(messages: Reference[], prompt: string, taskConfig: Record<string, unknown>) {
    const systemPrompt = stringValue(taskConfig.systemPrompt);
    const input = (messages.length ? messages : [{ role: "user", content: prompt }]).map(toOpenAiMessage);
    return systemPrompt ? [{ role: "system", content: systemPrompt }, ...input] : input;
}

function toGeminiContents(messages: Reference[], prompt: string) {
    const input = messages.length ? messages : [{ role: "user", content: prompt }];
    return input.map((message) => ({ role: stringValue(message.role) === "assistant" ? "model" : "user", parts: geminiMessageParts(message) }));
}

function toOpenAiMessage(message: Reference) {
    const role = stringValue(message.role) || "user";
    const content = message.content;
    if (!Array.isArray(content)) return { role, content: messageText(message) };
    return {
        role,
        content: content
            .map((item) => {
                const part = recordValue(item);
                if (part.type === "text") return { type: "input_text", text: stringValue(part.text) };
                if (part.type === "image_url") return { type: "input_image", image_url: stringValue(recordValue(part.image_url).url) };
                return null;
            })
            .filter(Boolean),
    };
}

function geminiMessageParts(message: Reference) {
    const content = message.content;
    if (!Array.isArray(content)) return [{ text: messageText(message) }];
    return content
        .map((item) => {
            const part = recordValue(item);
            if (part.type === "text") return { text: stringValue(part.text) };
            if (part.type === "image_url") return geminiImageUrlPart(stringValue(recordValue(part.image_url).url));
            return null;
        })
        .filter(Boolean);
}

function geminiImageUrlPart(url: string) {
    if (url.startsWith("data:")) {
        const media = parseDataUrl(url);
        return { inlineData: { mimeType: media.mimeType, data: media.buffer.toString("base64") } };
    }
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function messageText(message: Reference) {
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((item) => stringValue(recordValue(item).text)).filter(Boolean).join("\n");
    return stringValue(message.text);
}

function textFromResponseOutput(output: unknown) {
    if (!Array.isArray(output)) return "";
    return output
        .flatMap((item) => (Array.isArray(recordValue(item).content) ? (recordValue(item).content as unknown[]) : []))
        .map((item) => stringValue(recordValue(item).text))
        .join("");
}

function textFromGemini(payload: Record<string, unknown>) {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    return candidates
        .flatMap((candidate) => (Array.isArray(recordValue(recordValue(candidate).content).parts) ? (recordValue(recordValue(candidate).content).parts as unknown[]) : []))
        .map((part) => stringValue(recordValue(part).text))
        .join("");
}

async function throwIfCancelled(taskId: string) {
    const task = await getTask(taskId);
    if (task?.cancelRequested) throw new Error("生成任务已取消");
}

async function markCancelled(taskId: string) {
    await db.update(generationTasks).set({ status: "cancelled", updatedAt: now(), completedAt: now() }).where(eq(generationTasks.id, taskId));
}

async function getTask(id: string) {
    const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, id)).limit(1);
    return task;
}

async function fetchJson<T>(url: string, init: RequestInit = {}) {
    const response = await fetch(url, init);
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as T) : ({} as T);
    if (!response.ok) throw new Error(readApiError(payload) || `请求失败：${response.status}`);
    return payload;
}

async function readBinaryResponse(response: Response, fallback: string) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(await readResponseError(response, buffer, fallback));
    if ((response.headers.get("content-type") || "").includes("json")) {
        const message = readApiError(JSON.parse(buffer.toString("utf8")) as unknown);
        if (message) throw new Error(message);
    }
    return buffer;
}

async function readResponseError(response: Response, buffer: Buffer, fallback: string) {
    try {
        const message = readApiError(JSON.parse(buffer.toString("utf8")) as unknown);
        if (message) return message;
    } catch {
        // ignore non-json provider errors
    }
    return response.status ? `${fallback}：${response.status}` : fallback;
}

function buildApiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    const apiBase = lower.endsWith("/v1") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3") ? normalized : `${normalized}/v1`;
    return `${apiBase}${path}`;
}

function geminiApiUrl(channel: AiChannel, model: string, action: string) {
    const normalized = channel.baseUrl.trim().replace(/\/+$/, "");
    const base = normalized.toLowerCase().endsWith("/v1beta") || normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1beta`;
    return `${base}/models/${encodeURIComponent(model.replace(/^models\//, ""))}:${action}`;
}

function authHeaders(channel: AiChannel) {
    return { Authorization: `Bearer ${channel.apiKey || ""}` };
}

function openAiHeaders(channel: AiChannel) {
    return { ...authHeaders(channel), "Content-Type": "application/json" };
}

function geminiHeaders(channel: AiChannel) {
    return { "x-goog-api-key": channel.apiKey || "", "Content-Type": "application/json" };
}

function unwrapEnvelope(value: unknown): Record<string, unknown> {
    const payload = recordValue(value);
    if ("code" in payload && payload.code !== 0 && payload.code !== "0" && payload.code !== 200) throw new Error(readApiError(payload) || "请求失败");
    return recordValue(payload.data) || payload;
}

function videoResultUrl(value: Record<string, unknown>) {
    const content = recordValue(value.content);
    return stringValue(value.url) || stringValue(value.result_url) || stringValue(value.video_url) || stringValue(content.video_url) || stringValue(content.url);
}

function readApiError(value: unknown): string {
    const payload = recordValue(value);
    const error = recordValue(payload.error);
    return stringValue(payload.msg) || stringValue(payload.message) || stringValue(error.message);
}

function parseDataUrl(value: string) {
    const match = value.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error("Data URL 格式不正确");
    return { buffer: Buffer.from(match[2], "base64"), mimeType: match[1] };
}

function firstModel(channel: AiChannel) {
    return Array.isArray(channel.models) ? String(channel.models[0] || "") : "";
}

function recordConfig(value: unknown) {
    return recordValue(value);
}

function recordArray(value: unknown): Reference[] {
    return Array.isArray(value) ? value.map(recordValue) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function optionalString(key: string, value: string) {
    return value ? { [key]: value } : {};
}

function withSystemPrompt(configValue: Record<string, unknown>, prompt: string) {
    const systemPrompt = stringValue(configValue.systemPrompt).trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function systemInstruction(configValue: Record<string, unknown>) {
    const systemPrompt = stringValue(configValue.systemPrompt).trim();
    return systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {};
}

function normalizeImageQuality(value: unknown) {
    const quality = stringValue(value);
    return ["low", "medium", "high", "standard", "hd"].includes(quality) ? quality : "";
}

function normalizeAudioVoice(value: unknown) {
    const voice = stringValue(value);
    return voice || "alloy";
}

function normalizeAudioFormat(value: unknown) {
    const format = stringValue(value);
    return ["mp3", "wav", "opus", "aac", "flac", "pcm"].includes(format) ? format : "mp3";
}

function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus") return "audio/opus";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    if (format === "pcm") return "audio/pcm";
    return "audio/mpeg";
}

function normalizeVideoSize(value: unknown) {
    const size = stringValue(value);
    if (!size || size === "auto") return "";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: unknown) {
    const resolution = stringValue(value);
    if (resolution === "low") return "480p";
    if (!resolution || resolution === "auto" || resolution === "high" || resolution === "medium") return "720p";
    return `${resolution.replace(/p$/i, "") || "720"}p`;
}

function normalizeSeedanceRatio(value: unknown) {
    const ratio = stringValue(value);
    if (!ratio || ratio === "auto") return "adaptive";
    return ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(ratio) ? ratio : "adaptive";
}

function isSeedance(channel: AiChannel, model: string) {
    const value = model.toLowerCase();
    return value.includes("seedance") || value.includes("doubao-seedance") || channel.baseUrl.toLowerCase().includes("/api/plan/v3");
}

function booleanValue(value: unknown, fallback: boolean) {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Number(number.toFixed(2)))) : fallback;
}

function extensionForMime(mimeType: string, fallback: string) {
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    return fallback;
}

function concurrencyFor(kind: TaskKind) {
    if (kind === "video") return config.workerConcurrency.video;
    if (kind === "audio") return config.workerConcurrency.audio;
    return config.workerConcurrency.image;
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
