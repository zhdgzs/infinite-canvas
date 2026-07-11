export type ApiResponse<T> = {
    code: number;
    msg: string;
    data: T;
};

export class ApiError extends Error {
    code: number;
    status: number;

    constructor(message: string, code: number, status: number) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}) {
    const response = await fetch(path, {
        ...options,
        credentials: "include",
        headers: {
            ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
        },
    });
    const payload = (await response.json().catch(() => ({ code: response.status, msg: response.statusText || "请求失败", data: {} }))) as ApiResponse<T>;
    if (!response.ok || payload.code !== 200) throw new ApiError(payload.msg || "请求失败", payload.code || response.status, response.status);
    return payload.data;
}

export function apiGet<T>(path: string) {
    return apiRequest<T>(path);
}

export function apiPost<T>(path: string, body?: unknown) {
    return apiRequest<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiPut<T>(path: string, body?: unknown) {
    return apiRequest<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiDelete<T>(path: string) {
    return apiRequest<T>(path, { method: "DELETE" });
}

export function apiUpload<T>(path: string, formData: FormData) {
    return apiRequest<T>(path, { method: "POST", body: formData });
}
