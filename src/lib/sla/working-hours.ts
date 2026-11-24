const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 18;

export function addWorkingHours(start: Date, hours: number): Date {
    let remaining = hours * 60 * 60 * 1000;
    let cursor = start.getTime() + IST_OFFSET_MS;

    while (true) {
        const d = new Date(cursor);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        const dayStart = Date.UTC(y, m, day, DAY_START_HOUR);
        const dayEnd = Date.UTC(y, m, day, DAY_END_HOUR);

        if (d.getUTCDay() !== 0 && cursor < dayEnd) {
            const from = Math.max(cursor, dayStart);
            const available = dayEnd - from;
            if (remaining <= available) return new Date(from + remaining - IST_OFFSET_MS);
            remaining -= available;
        }
        cursor = Date.UTC(y, m, day + 1);
    }
}
