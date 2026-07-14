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
