'use strict';

/**
 * Best-effort, dependency-free PDF text extractor.
 *
 * It inflates FlateDecode streams with zlib and walks the content operators that
 * carry text (Tj, TJ, ', "). It is intentionally conservative: if a PDF uses
 * features it cannot read (encryption, embedded CMap/CID fonts, object streams),
 * it returns whatever it can and the caller decides whether that is enough.
 * Plain "paste text" always remains available as a fallback.
 */

const zlib = require('zlib');

function inflateStream(buffer) {
    const attempts = [
        () => zlib.inflateSync(buffer),
        () => zlib.inflateRawSync(buffer),
    ];
    for (const attempt of attempts) {
        try {
            return attempt();
        } catch {
            // try the next strategy
        }
    }
    return null;
}

function decodeEscape(source, index) {
    const next = source[index + 1];
    switch (next) {
        case 'n': return { char: '\n', length: 2 };
        case 'r': return { char: '\r', length: 2 };
        case 't': return { char: '\t', length: 2 };
        case 'b': return { char: '\b', length: 2 };
        case 'f': return { char: '\f', length: 2 };
        case '(': return { char: '(', length: 2 };
        case ')': return { char: ')', length: 2 };
        case '\\': return { char: '\\', length: 2 };
        case undefined: return { char: '', length: 1 };
        default:
            if (/[0-7]/.test(next)) {
                let octal = '';
                let length = 1;
                while (length < 4 && /[0-7]/.test(source[index + length])) {
                    octal += source[index + length];
                    length += 1;
                }
                return { char: String.fromCharCode(parseInt(octal, 8)), length };
            }
            return { char: next, length: 2 };
    }
}

function readLiteralString(source, start) {
    let index = start + 1;
    let depth = 1;
    let out = '';

    while (index < source.length) {
        const char = source[index];
        if (char === '\\') {
            const decoded = decodeEscape(source, index);
            out += decoded.char;
            index += decoded.length;
            continue;
        }
        if (char === '(') {
            depth += 1;
            out += char;
            index += 1;
            continue;
        }
        if (char === ')') {
            depth -= 1;
            index += 1;
            if (depth === 0) {
                break;
            }
            out += char;
            continue;
        }
        out += char;
        index += 1;
    }

    return { text: out, next: index };
}

function readHexString(source, start) {
    let index = start + 1;
    let hex = '';
    while (index < source.length && source[index] !== '>') {
        const char = source[index];
        if (/[0-9a-fA-F]/.test(char)) {
            hex += char;
        }
        index += 1;
    }
    index += 1; // skip '>'

    if (hex.length % 2 === 1) {
        hex += '0';
    }

    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }

    let text;
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        text = '';
        for (let i = 2; i + 1 < bytes.length; i += 2) {
            text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        }
    } else {
        text = Buffer.from(bytes).toString('latin1');
    }

    return { text, next: index };
}

function extractFromContent(content) {
    let out = '';
    let index = 0;

    while (index < content.length) {
        const char = content[index];

        if (char === '(') {
            const literal = readLiteralString(content, index);
            out += literal.text;
            index = literal.next;
            continue;
        }

        if (char === '<' && content[index + 1] !== '<') {
            const hex = readHexString(content, index);
            out += hex.text;
            index = hex.next;
            continue;
        }

        if (char === 'T' && content[index + 1] === 'd') {
            out += '\n';
            index += 2;
            continue;
        }
        if (char === 'T' && content[index + 1] === 'D') {
            out += '\n';
            index += 2;
            continue;
        }
        if (char === 'T' && content[index + 1] === '*') {
            out += '\n';
            index += 2;
            continue;
        }
        if (char === 'B' && content[index + 1] === 'T') {
            out += '\n';
            index += 2;
            continue;
        }
        if (char === 'E' && content[index + 1] === 'T') {
            out += '\n';
            index += 2;
            continue;
        }
        if (char === "'" || char === '"') {
            out += '\n';
            index += 1;
            continue;
        }

        index += 1;
    }

    return out;
}

function cleanText(text) {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n /g, '\n')
        .trim();
}

function isPdf(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
        return false;
    }
    return buffer.slice(0, 1024).includes(Buffer.from('%PDF-'));
}

function extractText(buffer) {
    if (!isPdf(buffer)) {
        const error = new Error('The uploaded file is not a readable PDF.');
        error.code = 'not_pdf';
        throw error;
    }

    const raw = buffer.toString('latin1');
    const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;

    let text = '';
    let match;
    while ((match = streamPattern.exec(raw)) !== null) {
        const chunk = Buffer.from(match[1], 'latin1');
        const inflated = inflateStream(chunk);
        const content = inflated ? inflated.toString('latin1') : match[1];
        text += extractFromContent(content) + '\n';
    }

    const cleaned = cleanText(text);
    if (cleaned === '') {
        const error = new Error('No selectable text was found in the PDF. It may be a scanned image.');
        error.code = 'no_text';
        throw error;
    }

    return cleaned;
}

module.exports = { extractText, isPdf };
