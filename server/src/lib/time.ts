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
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
