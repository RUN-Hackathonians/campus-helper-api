'use strict';

// Configure before the server module captures its settings.
process.env.AI_PROVIDER = 'mock';
process.env.MAX_UPLOAD_BYTES = '2000';
process.env.RATE_LIMIT_MAX = '1000';

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

test('oversized uploads are rejected with a file-size error', async () => {
    const form = new FormData();
    form.append('mode', 'text');
    form.append('text', 'x'.repeat(5000));

    const response = await fetch(base + '/api/process', { method: 'POST', body: form });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'too_large');
});
