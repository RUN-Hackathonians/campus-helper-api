'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../server/rate-limit.js');

test('allows requests up to the limit then blocks the rest', () => {
    const take = createRateLimiter({ windowMs: 60000, max: 3 });
    assert.equal(take('1.1.1.1').allowed, true);
    assert.equal(take('1.1.1.1').allowed, true);
    const third = take('1.1.1.1');
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);
    assert.equal(take('1.1.1.1').allowed, false);
});

test('tracks clients independently', () => {
    const take = createRateLimiter({ windowMs: 60000, max: 1 });
    assert.equal(take('a').allowed, true);
    assert.equal(take('a').allowed, false);
    assert.equal(take('b').allowed, true);
});

test('resets after the window elapses', () => {
    let now = 0;
    const take = createRateLimiter({ windowMs: 1000, max: 1 });
    const original = Date.now;
    Date.now = () => now;
    try {
        assert.equal(take('x').allowed, true);
        assert.equal(take('x').allowed, false);
        now = 1500;
        assert.equal(take('x').allowed, true);
    } finally {
        Date.now = original;
    }
});
