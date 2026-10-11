'use strict';

/**
 * Minimal, dependency-free multipart/form-data parser.
 * Good enough for the small forms this app posts (a PDF and/or text fields).
 * Operates on a Buffer so binary file data is never corrupted by re-encoding.
 */

const CRLF = Buffer.from('\r\n');
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');

function parseBoundary(contentType) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!match) {
        return null;
    }
    return (match[1] || match[2] || '').trim() || null;
}

function parseHeaders(raw) {
    const headers = {};
    raw.split('\r\n').forEach((line) => {
        const index = line.indexOf(':');
        if (index === -1) {
            return;
        }
        const name = line.slice(0, index).trim().toLowerCase();
        headers[name] = line.slice(index + 1).trim();
    });
    return headers;
}

function parseDisposition(value) {
    const result = { name: null, filename: null };
    if (!value) {
        return result;
    }

    const nameMatch = /name="([^"]*)"/i.exec(value);
    if (nameMatch) {
        result.name = nameMatch[1];
    }

    const filenameMatch = /filename="([^"]*)"/i.exec(value);
    if (filenameMatch) {
        result.filename = filenameMatch[1];
    } else {
        const extended = /filename\*=([^;]+)/i.exec(value);
        if (extended) {
            const encoded = extended[1].split("''").pop();
            try {
                result.filename = decodeURIComponent(encoded);
            } catch {
                result.filename = encoded;
            }
        }
    }

    return result;
}

/**
 * @param {Buffer} buffer raw request body
 * @param {string} contentType the request Content-Type header
 * @returns {{ fields: Object<string,string>, files: Object<string,{name:string,data:Buffer,type:string}> }}
 */
function parseMultipart(buffer, contentType) {
    const boundary = parseBoundary(contentType);
    if (!boundary) {
        throw new Error('missing multipart boundary');
    }

    const delimiter = Buffer.concat([CRLF, Buffer.from('--' + boundary)]);
    const data = Buffer.concat([CRLF, buffer]);

    const fields = {};
    const files = {};

    let cursor = data.indexOf(delimiter);
    if (cursor === -1) {
        return { fields, files };
    }
    cursor += delimiter.length;

    while (cursor < data.length) {
        const next = data.indexOf(delimiter, cursor);
        const end = next === -1 ? data.length : next;
        let segment = data.slice(cursor, end);

        if (segment.length >= 2 && segment[0] === 0x2d && segment[1] === 0x2d) {
            break; // closing boundary "--"
        }

        if (segment.slice(0, 2).equals(CRLF)) {
            segment = segment.slice(2);
        }

        const split = segment.indexOf(HEADER_SEPARATOR);
        if (split !== -1) {
            const headerText = segment.slice(0, split).toString('utf8');
            const body = segment.slice(split + HEADER_SEPARATOR.length);
            const headers = parseHeaders(headerText);
            const disposition = parseDisposition(headers['content-disposition']);

            if (disposition.name) {
                if (disposition.filename !== null) {
                    files[disposition.name] = {
                        name: disposition.filename,
                        type: headers['content-type'] || 'application/octet-stream',
                        data: body,
                    };
                } else {
                    fields[disposition.name] = body.toString('utf8');
                }
            }
        }

        if (next === -1) {
            break;
        }
        cursor = next + delimiter.length;
    }

    return { fields, files };
}

module.exports = { parseMultipart, parseBoundary, parseDisposition };
