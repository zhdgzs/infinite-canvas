import { apiGet, apiPost, apiPut } from "@/services/api/client";
import type { AiConfig, ModelChannel } from "@/stores/use-config-store";

export type RemoteAiChannel = Omit<ModelChannel, "apiKey"> & {
    apiKey?: undefined;
    hasApiKey: boolean;
    apiKeyMasked: string;
};

export type RemoteAiConfig = {
    channels: RemoteAiChannel[];
    preferences: Record<string, unknown>;
};

export async function fetchAiConfig() {
    return apiGet<RemoteAiConfig>("/api/ai/config");
}

export async function saveAiConfig(config: AiConfig) {
    return apiPut<RemoteAiConfig>("/api/ai/config", {
        channels: config.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            baseUrl: channel.baseUrl,
            apiFormat: channel.apiFormat,
            ...(channel.apiKey.trim() ? { apiKey: channel.apiKey.trim() } : {}),
            models: channel.models,
        })),
        preferences: configPreferences(config),
    });
}

export async function refreshAiChannelModels(channelId: string) {
    return apiPost<RemoteAiChannel>(`/api/ai/channels/${encodeURIComponent(channelId)}/models/refresh`);
}

function configPreferences(config: AiConfig) {
    const { channels: _channels, apiKey: _apiKey, baseUrl: _baseUrl, apiFormat: _apiFormat, ...preferences } = config;
    return preferences;
}
