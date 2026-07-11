export function pagination(query: unknown) {
    const source = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
    const page = clampNumber(source.page, 1, 1, 100000);
    const pageSize = clampNumber(source.pageSize, 30, 1, 100);
    return {
        page,
        pageSize,
        offset: (page - 1) * pageSize,
    };
}

export function queryString(query: unknown, key: string) {
    const source = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
    const value = source[key];
    return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}
