'use strict';

process.env.AI_PROVIDER = 'mock';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createServer } = require('../server.js');

let server;
let base;

const NOTES = [
    'Photosynthesis converts light energy into chemical energy stored in glucose.',
    'The mitochondria generate most of the cell energy through cellular respiration.',
    'Water moves across a semipermeable membrane by osmosis from high to low concentration.',
    'Enzymes are biological catalysts that lower the activation energy of reactions.',
].join(' ');

before(async () => {
    server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

function postForm(path, fields, file) {
    const form = new FormData();
    Object.entries(fields || {}).forEach(([key, value]) => form.append(key, String(value)));
    if (file) {
        form.append('file', new Blob([file.data], { type: file.type }), file.name);
    }
    return fetch(base + path, { method: 'POST', body: form });
}

test('serves the static page', async () => {
    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /campus_helper/);
});

test('POST /api/process returns a summary (regression)', async () => {
    const response = await postForm('/api/process', { mode: 'text', text: NOTES });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.summary, 'string');
    assert.ok(body.summary.trim().length > 0);
    assert.ok(Array.isArray(body.turns));
});

test('POST /api/quiz generates validated questions from pasted notes', async () => {
    const response = await postForm('/api/quiz', {
        mode: 'text',
        text: NOTES,
        count: 3,
        types: 'mcq,truefalse,short',
        difficulty: 'easy',
        explanations: 'true',
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.quiz.questions.length > 0);
    assert.equal(body.meta.provider, 'mock');
    for (const question of body.quiz.questions) {
        assert.ok(['mcq', 'truefalse', 'short'].includes(question.type));
        assert.ok(typeof question.prompt === 'string' && question.prompt.length > 0);
        if (question.type === 'mcq') {
            assert.ok(Array.isArray(question.options) && question.options.length >= 2);
            assert.ok(question.options.some((option) => option.id === question.correctOptionId));
        }
        if (question.type === 'truefalse') {
            assert.equal(typeof question.correctBool, 'boolean');
        }
        if (question.type === 'short') {
            assert.ok(typeof question.expected === 'string' && question.expected.length > 0);
        }
    }
});

test('POST /api/quiz honours requested difficulty', async () => {
    const response = await postForm('/api/quiz', { mode: 'text', text: NOTES, count: 2, types: 'mcq', difficulty: 'hard' });
    const body = await response.json();
    assert.equal(body.quiz.difficulty, 'hard');
});

test('POST /api/quiz rejects empty source material', async () => {
    const response = await postForm('/api/quiz', { mode: 'text', text: 'too short' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'empty');
});

test('POST /api/process reads text from an uploaded PDF', async () => {
    const content = Buffer.from('BT (Cell biology lecture: mitochondria produce ATP) Tj ET', 'latin1');
    const pdf = Buffer.from('%PDF-1.4\nstream\n' + content.toString('latin1') + '\nendstream\n', 'latin1');

    const response = await postForm('/api/process', { mode: 'pdf' }, {
        name: 'notes.pdf',
        type: 'application/pdf',
        data: pdf,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.summary, /mitochondria/i);
});

test('POST /api/quiz rejects unsupported files', async () => {
    const response = await postForm('/api/quiz', { mode: 'pdf' }, {
        name: 'notes.txt',
        type: 'text/plain',
        data: Buffer.from('just some text pretending to be a file'),
    });
    assert.equal(response.status, 415);
});

test('POST /api/grade grades short answers with the offline provider', async () => {
    const response = await fetch(base + '/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items: [
                { id: 'q1', question: 'What produces energy?', expected: 'mitochondria', acceptable: [], answer: 'the mitochondria' },
                { id: 'q2', question: 'What is osmosis?', expected: 'water movement', acceptable: [], answer: 'photosynthesis' },
            ],
        }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].correct, true);
    assert.equal(body.results[1].correct, false);
});

test('POST /api/grade rejects empty payloads', async () => {
    const response = await fetch(base + '/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
    });
    assert.equal(response.status, 400);
});

test('unknown routes return 404 and wrong methods return 405', async () => {
    const missing = await fetch(base + '/api/nope', { method: 'POST' });
    assert.equal(missing.status, 404);

    const wrong = await fetch(base + '/api/quiz', { method: 'GET' });
    assert.equal(wrong.status, 405);
});
