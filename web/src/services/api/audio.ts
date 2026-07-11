import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { createGenerationTask, pollGenerationTask } from "@/services/api/generations";

type RequestOptions = { signal?: AbortSignal; onTaskCreated?: (id: string) => void };
type AudioTaskResult = { audio?: StoredAudio };
type StoredAudio = { storageKey: string; bytes: number; mimeType: string; durationMs?: number };
type StoredAudioBlob = Blob & { storedAudio?: StoredAudio };

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const selectedModel = config.model || config.audioModel;
    const channel = resolveModelChannel(config, selectedModel);
    const task = await createGenerationTask<AudioTaskResult>(
        {
            kind: "audio",
            prompt,
            channelId: channel.id,
            model: modelOptionName(selectedModel),
            config: {
                audioVoice: normalizeAudioVoiceValue(config.audioVoice),
                audioFormat: normalizeAudioFormatValue(config.audioFormat),
                audioSpeed: normalizeAudioSpeedValue(config.audioSpeed),
                audioInstructions: config.audioInstructions,
            },
            references: [],
        },
        options,
    );
    const result = await pollGenerationTask<AudioTaskResult>(task.id, options);
    if (result.status !== "succeeded" || !result.result.audio?.storageKey) throw new Error(result.error || "音频生成失败");
    const blob = await getMediaBlob(result.result.audio.storageKey);
    if (!blob) throw new Error("音频文件读取失败");
    return Object.assign(blob, { storedAudio: result.result.audio });
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const stored = (blob as StoredAudioBlob).storedAudio;
    if (stored?.storageKey) {
        return {
            url: await resolveMediaUrl(stored.storageKey),
            storageKey: stored.storageKey,
            bytes: stored.bytes,
            mimeType: stored.mimeType,
            durationMs: stored.durationMs,
        };
    }
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}
