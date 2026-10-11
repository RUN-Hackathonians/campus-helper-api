'use strict';

/**
 * campus_helper server.
 *
 * Serves the static frontend and the small API the page needs:
 *   POST /api/process  -> summarize study material
 *   POST /api/quiz     -> generate a validated quiz from study material
 *   POST /api/grade    -> grade short-answer responses
 *
 * Runtime dependencies: none (Node built-ins only). Secrets (such as the AI
 * provider key) are read from the environment and never sent to the client.
 */

const http = require('http');
const path = require('path');

const { sendJson, serveStatic } = require('./server/http-utils');
const { createRateLimiter } = require('./server/rate-limit');
const { handleProcess, handleQuiz, handleGrade, HttpError } = require('./server/handlers');
const ai = require('./server/ai');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5501;
const HOST = process.env.HOST || '127.0.0.1';

const limiter = createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 30,
});

function clientKey(req) {
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

const ROUTES = {
    '/api/process': handleProcess,
    '/api/quiz': handleQuiz,
    '/api/grade': handleGrade,
};

function guardRate(req, res, pathname) {
    const result = limiter(clientKey(req));
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));
    if (!result.allowed) {
        sendJson(res, 429, {
            error: 'limit',
            message: "You've reached the current usage limit. Please try again later.",
        });
        return false;
    }
    return true;
}

async function route(req, res, pathname) {
    const handler = ROUTES[pathname];

    if (!handler) {
        sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
        return;
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'method_not_allowed', message: 'Use POST for this endpoint.' });
        return;
    }

    if (!guardRate(req, res, pathname)) {
        return;
    }

    await handler(req, res);
}

function createServer() {
    return http.createServer((req, res) => {
        let pathname;
        try {
            pathname = decodeURIComponent((req.url || '/').split('?')[0]);
        } catch {
            sendJson(res, 400, { error: 'bad_request', message: 'Bad request.' });
            return;
        }

        if (Object.prototype.hasOwnProperty.call(ROUTES, pathname)) {
            route(req, res, pathname).catch((error) => {
                if (res.headersSent) {
                    res.destroy();
                    return;
                }
                if (error instanceof HttpError) {
                    sendJson(res, error.status, { error: error.code, message: error.message });
                    return;
                }
                console.error('Unhandled API error:', error && error.message);
                sendJson(res, 500, { error: 'server', message: 'Something went wrong. Please try again.' });
            });
            return;
        }

        if (pathname.indexOf('/api/') === 0) {
            sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
            return;
        }

        if (req.method === 'GET' || req.method === 'HEAD') {
            serveStatic(req, res, ROOT, pathname);
            return;
        }

        sendJson(res, 405, { error: 'method_not_allowed', message: 'Method not allowed.' });
    });
}

if (require.main === module) {
    const server = createServer();
    server.listen(PORT, HOST, () => {
        console.log(`campus_helper running at http://${HOST}:${PORT}`);
        console.log(`AI provider: ${ai.providerName()}${ai.providerName() === 'mock' ? ' (set OPENAI_API_KEY for live generation)' : ''}`);
    });

    const shutdown = () => {
        server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { createServer, PORT, HOST };
