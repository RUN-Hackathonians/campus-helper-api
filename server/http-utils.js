'use strict';

const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
};

function securityHeaders() {
    return {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': [
            "default-src 'self'",
            "img-src 'self' data:",
            "style-src 'self'",
            "script-src 'self'",
            "connect-src 'self'",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ].join('; '),
    };
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    }, securityHeaders()));
    res.end(body);
}

function sendNoContent(res, status) {
    res.writeHead(status, securityHeaders());
    res.end();
}

function readBody(req, limitBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;

        const fail = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        };

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                if (!settled) {
                    const error = new Error('Request body too large.');
                    error.code = 'too_large';
                    fail(error);
                }
                // Keep draining so the error response can still be flushed.
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(Buffer.concat(chunks));
        });

        req.on('error', (error) => {
            fail(error);
        });
    });
}

function readJsonBody(req, limitBytes) {
    return readBody(req, limitBytes).then((buffer) => {
        if (buffer.length === 0) {
            return {};
        }
        try {
            return JSON.parse(buffer.toString('utf8'));
        } catch {
            const error = new Error('Invalid JSON body.');
            error.code = 'invalid_json';
            throw error;
        }
    });
}

function serveStatic(req, res, rootDir, urlPath) {
    let pathname;
    try {
        pathname = decodeURIComponent((urlPath || '/').split('?')[0]);
    } catch {
        sendJson(res, 400, { error: 'bad_request' });
        return;
    }

    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    }

    const resolved = path.normalize(path.join(rootDir, pathname));
    const rootResolved = path.resolve(rootDir);
    if (!resolved.startsWith(rootResolved)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }

    fs.stat(resolved, (err, stats) => {
        if (err || !stats.isFile()) {
            sendJson(res, 404, { error: 'not_found' });
            return;
        }

        const type = MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, Object.assign({
            'Content-Type': type,
            'Content-Length': stats.size,
            'Cache-Control': 'no-cache',
        }, securityHeaders()));

        if (req.method === 'HEAD') {
            res.end();
            return;
        }

        const stream = fs.createReadStream(resolved);
        stream.on('error', () => {
            res.destroy();
        });
        stream.pipe(res);
    });
}

module.exports = {
    MIME_TYPES,
    securityHeaders,
    sendJson,
    sendNoContent,
    readBody,
    readJsonBody,
    serveStatic,
};
