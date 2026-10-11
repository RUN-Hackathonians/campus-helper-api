'use strict';

// Configure before the server module captures its settings.
process.env.AI_PROVIDER = 'mock';
process.env.RATE_LIMIT_MAX = '2';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createServer } = require('../server.js');

let server;
let base;

before(async () => {
    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

function postText() {
    const form = new FormData();
    form.append('mode', 'text');
    form.append('text', 'A reasonably long set of lecture notes used for the rate limit test case.');
    return fetch(base + '/api/process', { method: 'POST', body: form });
}

test('the AI endpoints enforce a per-client rate limit', async () => {
    const first = await postText();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-ratelimit-limit'), '2');

    const second = await postText();
    assert.equal(second.status, 200);

    const third = await postText();
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, 'limit');
});
