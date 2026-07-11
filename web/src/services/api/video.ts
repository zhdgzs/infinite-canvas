import { createGenerationTask, getGenerationTask, pollGenerationTask } from "@/services/api/generations";
import { resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal; onTaskCreated?: (id: string) => void };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; storageKey?: string; bytes?: number; width?: number; height?: number; durationMs?: number };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "server"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

type VideoTaskResult = { video?: VideoGenerationResult };

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const remote = await pollGenerationTask<VideoTaskResult>(task.id, { signal: options?.signal, intervalMs: 1200 });
    if (remote.status !== "succeeded") throw new Error(remote.error || "视频生成失败");
    if (!remote.result.video) throw new Error("视频接口没有返回可播放的视频");
    return remote.result.video;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const channel = resolveModelChannel(config, selectedModel);
    const task = await createGenerationTask<VideoTaskResult>(
        {
            kind: "video",
            prompt,
            channelId: channel.id,
            model: modelOptionName(selectedModel),
            config: videoTaskConfig(config),
            references: [...references.map(imageReferenceToTaskInput), ...videoReferences.map((item) => mediaReferenceToTaskInput(item, "video")), ...audioReferences.map((item) => mediaReferenceToTaskInput(item, "audio"))],
        },
        options,
    );
    return { id: task.id, provider: "server", model: selectedModel };
}

export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, _options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const remote = await getGenerationTask<VideoTaskResult>(task.id);
    if (remote.status === "failed" || remote.status === "cancelled") return { status: "failed", error: remote.error || "视频生成失败" };
    if (remote.status !== "succeeded") return { status: "pending" };
    if (!remote.result.video) return { status: "failed", error: "视频接口没有返回可播放的视频" };
    return { status: "completed", result: remote.result.video };
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.storageKey) return { url: await resolveMediaUrl(result.storageKey), storageKey: result.storageKey, bytes: result.bytes || 0, mimeType: result.mimeType || "video/mp4", width: result.width, height: result.height, durationMs: result.durationMs };
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

function videoTaskConfig(config: AiConfig) {
    return {
        size: config.size,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
    };
}

function imageReferenceToTaskInput(reference: ReferenceImage) {
    return { id: reference.id, name: reference.name, kind: "image", type: reference.type, storageKey: reference.storageKey, dataUrl: reference.storageKey ? undefined : reference.dataUrl, url: reference.url };
}

function mediaReferenceToTaskInput(reference: ReferenceVideo | ReferenceAudio, kind: "video" | "audio") {
    return { id: reference.id, name: reference.name, kind, type: reference.type, storageKey: reference.storageKey, url: reference.url, durationMs: reference.durationMs };
}
