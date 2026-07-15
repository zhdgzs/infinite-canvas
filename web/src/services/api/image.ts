import { nanoid } from "nanoid";

import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { createGenerationTask, pollGenerationTask } from "@/services/api/generations";
import { resolveImageUrl } from "@/services/image-storage";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type RequestOptions = { signal?: AbortSignal; onTaskCreated?: (id: string) => void };
type StoredImageResult = { storageKey: string; width?: number; height?: number; bytes: number; mimeType: string };
type ImageTaskResult = { images?: StoredImageResult[] };
type TextTaskResult = { text?: string };

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const channel = resolveModelChannel(config, selectedModel);
    const task = await createGenerationTask(
        {
            kind: "image",
            prompt,
            channelId: channel.id,
            model: modelOptionName(selectedModel),
            config: imageTaskConfig(config, "generation"),
            references: [],
        },
        options,
    );
    return imagesFromTask(await pollGenerationTask<ImageTaskResult>(task.id, options));
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const channel = resolveModelChannel(config, selectedModel);
    const task = await createGenerationTask(
        {
            kind: "image",
            prompt: buildImageReferencePromptText(prompt, references),
            channelId: channel.id,
            model: modelOptionName(selectedModel),
            config: { ...imageTaskConfig(config, "edit"), ...(mask ? { mask: referenceToTaskInput(mask) } : {}) },
            references: references.map(referenceToTaskInput),
        },
        options,
    );
    return imagesFromTask(await pollGenerationTask<ImageTaskResult>(task.id, options));
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const selectedModel = config.model || config.textModel;
    const channel = resolveModelChannel(config, selectedModel);
    if (channel.apiFormat !== "gemini") return requestOpenAiTextStream(channel.id, modelOptionName(selectedModel), messages, config.systemPrompt, onDelta, options?.signal);
    const task = await createGenerationTask(
        {
            kind: "text",
            prompt: messages.map(messageText).filter(Boolean).join("\n"),
            channelId: channel.id,
            model: modelOptionName(selectedModel),
            config: { systemPrompt: config.systemPrompt, messages },
            references: [],
        },
        options,
    );
    const result = await pollGenerationTask<TextTaskResult>(task.id, options);
    if (result.status !== "succeeded") throw new Error(result.error || "请求失败");
    const answer = result.result.text || "没有返回内容";
    onDelta(answer);
    return answer;
}

async function requestOpenAiTextStream(channelId: string, model: string, messages: AiTextMessage[], systemPrompt: string, onDelta: (text: string) => void, signal?: AbortSignal) {
    const response = await fetch("/api/generations/text/stream", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: messages.map(messageText).filter(Boolean).join("\n"), channelId, model, config: { systemPrompt, messages } }),
        signal,
    });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { msg?: string } | null;
        throw new Error(payload?.msg || `请求失败：HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("上游未返回文本流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const consume = (block: string) => {
        const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /, ""))
            .join("\n")
            .trim();
        if (!data || data === "[DONE]") return;
        const event = JSON.parse(data) as Record<string, unknown>;
        const error = string(record(event.error).message) || string(record(record(event.response).error).message);
        if (error) throw new Error(error);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            text += event.delta;
            onDelta(text);
        }
        if (event.type === "response.output_text.done" && !text && typeof event.text === "string") {
            text = event.text;
            onDelta(text);
        }
        if (event.type === "response.completed" && !text) {
            const output = record(event.response).output;
            if (Array.isArray(output)) {
                text = output.flatMap((item) => (Array.isArray(record(item).content) ? (record(item).content as unknown[]) : [])).map((item) => string(record(item).text)).join("");
                if (text) onDelta(text);
            }
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
            const match = buffer.match(/\r?\n\r?\n/);
            if (!match) break;
            consume(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
        }
    }
    if (buffer.trim()) consume(buffer);
    return text || "没有返回内容";
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function string(value: unknown) {
    return typeof value === "string" ? value : "";
}

function imageTaskConfig(config: AiConfig, mode: "generation" | "edit") {
    return {
        mode,
        count: config.count,
        quality: config.quality,
        size: config.size,
        systemPrompt: config.systemPrompt,
    };
}

function referenceToTaskInput(reference: ReferenceImage) {
    return {
        id: reference.id,
        name: reference.name,
        kind: "image",
        type: reference.type,
        storageKey: reference.storageKey,
        dataUrl: reference.storageKey ? undefined : reference.dataUrl,
        url: reference.url,
    };
}

async function imagesFromTask(task: Awaited<ReturnType<typeof pollGenerationTask<ImageTaskResult>>>) {
    if (task.status !== "succeeded") throw new Error(task.error || "请求失败");
    const images = task.result.images || [];
    if (!images.length) throw new Error("接口没有返回图片");
    return Promise.all(
        images.map(async (image) => ({
            id: nanoid(),
            dataUrl: await resolveImageUrl(image.storageKey),
            storageKey: image.storageKey,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
            mimeType: image.mimeType,
        })),
    );
}

function messageText(message: AiTextMessage) {
    if (typeof message.content === "string") return message.content;
    return message.content.map((item) => (item.type === "text" ? item.text : "")).filter(Boolean).join("\n");
}
