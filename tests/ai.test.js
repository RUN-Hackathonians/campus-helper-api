'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Force the offline provider before the module captures its configuration.
delete process.env.AI_PROVIDER;
process.env.OPENAI_API_KEY = '';

const ai = require('../server/ai.js');

test('extractJson parses plain JSON', () => {
    assert.deepEqual(ai.extractJson('{"a":1}'), { a: 1 });
});

test('extractJson unwraps fenced code blocks', () => {
    assert.deepEqual(ai.extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('extractJson finds a JSON object inside surrounding text', () => {
    assert.deepEqual(ai.extractJson('Here you go: {"questions":[]} — enjoy!'), { questions: [] });
});

test('extractJson returns null for unusable output', () => {
    assert.equal(ai.extractJson('no json here'), null);
    assert.equal(ai.extractJson('{"a": }'), null);
    assert.equal(ai.extractJson(''), null);
});

test('provider defaults to mock without a key', () => {
    assert.equal(ai.providerName(), 'mock');
});
