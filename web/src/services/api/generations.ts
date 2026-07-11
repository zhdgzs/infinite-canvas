import { apiDelete, apiGet, apiPost, apiRequest } from "@/services/api/client";

export type GenerationKind = "image" | "video" | "audio" | "text";
export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type GenerationTask<T = unknown> = {
    id: string;
    kind: GenerationKind;
    status: GenerationStatus;
    prompt: string;
    channelId?: string | null;
    model?: string | null;
    config: Record<string, unknown>;
    references: Array<Record<string, unknown>>;
    result: T;
    error?: string | null;
    cancelRequested: boolean;
    createdAt: string;
    updatedAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
};

export type CreateGenerationPayload = {
    kind: GenerationKind;
    prompt?: string;
    channelId?: string;
    model?: string;
    config?: Record<string, unknown>;
    references?: Array<Record<string, unknown>>;
};

export type GenerationTaskPage<T = unknown> = {
    items: Array<GenerationTask<T>>;
    total: number;
    page: number;
    pageSize: number;
};

export async function listGenerationTasks<T = unknown>(params: { kind?: GenerationKind; page?: number; pageSize?: number } = {}) {
    const search = new URLSearchParams();
    search.set("page", String(params.page || 1));
    search.set("pageSize", String(params.pageSize || 100));
    if (params.kind) search.set("kind", params.kind);
    return apiGet<GenerationTaskPage<T>>(`/api/generations?${search.toString()}`);
}

export async function createGenerationTask<T = unknown>(payload: CreateGenerationPayload, options?: { signal?: AbortSignal; onTaskCreated?: (id: string) => void }) {
    const task = options?.signal ? await apiRequest<GenerationTask<T>>("/api/generations", { method: "POST", body: JSON.stringify(payload), signal: options.signal }) : await apiPost<GenerationTask<T>>("/api/generations", payload);
    options?.onTaskCreated?.(task.id);
    return task;
}

export async function getGenerationTask<T = unknown>(id: string) {
    return apiGet<GenerationTask<T>>(`/api/generations/${encodeURIComponent(id)}`);
}

export async function cancelGenerationTask<T = unknown>(id: string) {
    return apiPost<GenerationTask<T>>(`/api/generations/${encodeURIComponent(id)}/cancel`);
}

export async function deleteGenerationTask(id: string) {
    return apiDelete(`/api/generations/${encodeURIComponent(id)}`);
}

export async function pollGenerationTask<T = unknown>(id: string, options: { signal?: AbortSignal; intervalMs?: number } = {}) {
    const intervalMs = options.intervalMs || 1200;
    try {
        for (;;) {
            if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
            const task = await getGenerationTask<T>(id);
            if (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") return task;
            await delay(intervalMs, options.signal);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") await cancelGenerationTask(id).catch(() => undefined);
        throw error;
    }
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("请求已取消", "AbortError"));
            },
            { once: true },
        );
    });
}
