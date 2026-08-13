const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

export function computeNextRetryAt(attempts: number): Date {
    const minutes = BACKOFF_MINUTES[Math.min(Math.max(attempts, 1) - 1, BACKOFF_MINUTES.length - 1)]!;
    return new Date(Date.now() + minutes * 60 * 1000);
}

export const MAX_DELIVERY_ATTEMPTS = BACKOFF_MINUTES.length;
