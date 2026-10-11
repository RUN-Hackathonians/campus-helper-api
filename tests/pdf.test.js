'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');

const pdf = require('../server/pdf.js');

function buildPdf(contentBytes) {
    const header = '%PDF-1.4\n';
    const stream = 'stream\n' + contentBytes.toString('latin1') + '\nendstream\n';
    return Buffer.from(header + stream, 'latin1');
}

test('extractText reads an uncompressed content stream', () => {
    const content = Buffer.from('BT /F1 12 Tf 72 720 Td (Hello lecture notes) Tj Td (Second line) Tj ET', 'latin1');
    const text = pdf.extractText(buildPdf(content));
    assert.match(text, /Hello lecture notes/);
    assert.match(text, /Second line/);
});

test('extractText inflates a FlateDecode content stream', () => {
    const content = Buffer.from('BT (Compressed cell biology notes) Tj ET', 'latin1');
    const text = pdf.extractText(buildPdf(zlib.deflateSync(content)));
    assert.match(text, /Compressed cell biology notes/);
});

test('extractText decodes literal string escapes', () => {
    const content = Buffer.from('BT (Line one \\(with parens\\) and a tab\\t) Tj ET', 'latin1');
    const text = pdf.extractText(buildPdf(content));
    assert.match(text, /Line one \(with parens\) and a tab/);
});

test('extractText rejects non-PDF input', () => {
    assert.throws(() => pdf.extractText(Buffer.from('not a pdf')), /not a readable PDF/);
});

test('extractText reports PDFs without selectable text', () => {
    const buffer = Buffer.from('%PDF-1.4\nstream\nBT ET\nendstream\n', 'latin1');
    assert.throws(() => pdf.extractText(buffer), /No selectable text/);
});

test('isPdf detects the signature', () => {
    assert.equal(pdf.isPdf(Buffer.from('%PDF-1.7 rest', 'latin1')), true);
    assert.equal(pdf.isPdf(Buffer.from('plain text')), false);
});
