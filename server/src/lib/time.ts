const UTC_EIGHT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function now() {
    return new Date();
}

export function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

export function toIso(value: Date | string | null | undefined) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return `${new Date(date.getTime() + UTC_EIGHT_OFFSET_MS).toISOString().slice(0, -1)}+08:00`;
}

export function serializeDates(value: unknown): unknown {
    if (value instanceof Date) return toIso(value);
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) value[index] = serializeDates(value[index]);
        return value;
    }
    if (!isPlainObject(value)) return value;
    for (const [key, item] of Object.entries(value)) value[key] = serializeDates(item);
    return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
