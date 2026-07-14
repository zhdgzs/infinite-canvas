import { apiDelete, apiGet, apiPost, apiRequest } from "@/services/api/client";

export type GenerationKind = "image" | "video" | "audio" | "text";
export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type GenerationTaskRef = { id: string; status: "queued" };
export type GenerationTaskCommandResult = { id: string; status: GenerationStatus };
export type GenerationTaskState<T = unknown> =
    | { id: string; status: "queued" | "running" }
    | { id: string; status: "succeeded"; result: T }
    | { id: string; status: "failed" | "cancelled"; error: string | null };
export type GenerationTaskTerminal<T = unknown> = Extract<GenerationTaskState<T>, { status: "succeeded" | "failed" | "cancelled" }>;

export type GenerationRecord<T = unknown> = {
    id: string;
    kind: GenerationKind;
    status: GenerationStatus;
    prompt: string;
    model: string | null;
    config: Record<string, unknown>;
    references: Array<Record<string, unknown>>;
    result: T;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
};

export type CreateGenerationPayload = {
    kind: GenerationKind;
    prompt?: string;
    channelId?: string;
    model?: string;
    config?: Record<string, unknown>;
    references?: Array<Record<string, unknown>>;
};

export type GenerationRecordPage<T = unknown> = {
    items: Array<GenerationRecord<T>>;
    total: number;
    page: number;
    pageSize: number;
};

export async function listGenerationRecords<T = unknown>(params: { kind?: GenerationKind; page?: number; pageSize?: number } = {}) {
    const search = new URLSearchParams();
    search.set("page", String(params.page || 1));
    search.set("pageSize", String(params.pageSize || 100));
    if (params.kind) search.set("kind", params.kind);
    return apiGet<GenerationRecordPage<T>>(`/api/generations/records?${search.toString()}`);
}

export async function createGenerationTask(payload: CreateGenerationPayload, options?: { signal?: AbortSignal; onTaskCreated?: (id: string) => void }) {
    const task = options?.signal ? await apiRequest<GenerationTaskRef>("/api/generations/tasks", { method: "POST", body: JSON.stringify(payload), signal: options.signal }) : await apiPost<GenerationTaskRef>("/api/generations/tasks", payload);
    options?.onTaskCreated?.(task.id);
    return task;
}

export async function getGenerationTask<T = unknown>(id: string) {
    return apiGet<GenerationTaskState<T>>(`/api/generations/tasks/${encodeURIComponent(id)}`);
}

export async function cancelGenerationTask(id: string) {
    return apiPost<GenerationTaskCommandResult>(`/api/generations/tasks/${encodeURIComponent(id)}/cancel`);
}

export async function deleteGenerationRecord(id: string) {
    return apiDelete(`/api/generations/records/${encodeURIComponent(id)}`);
}

export async function pollGenerationTask<T = unknown>(id: string, options: { signal?: AbortSignal; intervalMs?: number } = {}): Promise<GenerationTaskTerminal<T>> {
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
