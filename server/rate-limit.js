'use strict';

/**
 * In-memory fixed-window rate limiter, keyed by client IP.
 * Deliberately small: the app is anonymous and ephemeral, so this only guards
 * the AI endpoints against runaway usage. No data is persisted.
 */
function createRateLimiter(options) {
    const config = Object.assign({
        windowMs: 60 * 1000,
        max: 30,
        maxKeys: 5000,
    }, options || {});

    const buckets = new Map();

    const now = () => Date.now();

    const prune = (time) => {
        if (buckets.size <= config.maxKeys) {
            return;
        }
        for (const [key, bucket] of buckets) {
            if (time - bucket.start >= config.windowMs) {
                buckets.delete(key);
            }
        }
    };

    return function take(key) {
        const id = key || 'unknown';
        const time = now();
        let bucket = buckets.get(id);

        if (!bucket || time - bucket.start >= config.windowMs) {
            bucket = { start: time, count: 0 };
            buckets.set(id, bucket);
        }

        bucket.count += 1;
        prune(time);

        const remaining = Math.max(0, config.max - bucket.count);
        const resetMs = Math.max(0, config.windowMs - (time - bucket.start));
        return {
            allowed: bucket.count <= config.max,
            limit: config.max,
            remaining,
            resetMs,
        };
    };
}

module.exports = { createRateLimiter };
