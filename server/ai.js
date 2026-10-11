'use strict';

/**
 * AI provider facade.
 *
 * - When OPENAI_API_KEY is set the server calls an OpenAI-compatible
 *   chat-completions endpoint. The key lives only on the server.
 * - Otherwise a deterministic offline provider (mock.js) is used, so the app
 *   is fully runnable and testable without credentials.
 *
 * Only validated, parsed results ever leave this module. Raw model output and
 * prompts are never exposed to the client.
 */

const prompts = require('./prompts');
const mock = require('./mock');

const CONFIG = {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 45000,
    forced: (process.env.AI_PROVIDER || '').toLowerCase(),
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS) || 4000,
};

function providerName() {
    if (CONFIG.forced === 'mock') {
        return 'mock';
    }
    if (CONFIG.forced === 'openai') {
        return 'openai';
    }
    return CONFIG.apiKey ? 'openai' : 'mock';
}

class AiError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = 'AiError';
        this.kind = kind;
    }
}

function extractJson(raw) {
    if (typeof raw !== 'string') {
        return null;
    }

    let text = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fence) {
        text = fence[1].trim();
    }

    try {
        return JSON.parse(text);
    } catch {
        // fall through to brace scanning
    }

    const start = text.indexOf('{');
    if (start === -1) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }

    return null;
}

async function callOpenAi(options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    const body = {
        model: CONFIG.model,
        messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.user },
        ],
        temperature: typeof options.temperature === 'number' ? options.temperature : 0.2,
        max_tokens: options.maxTokens || CONFIG.maxOutputTokens,
    };
    if (options.json) {
        body.response_format = { type: 'json_object' };
    }

    let response;
    try {
        response = await fetch(`${CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${CONFIG.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new AiError('timeout', 'The AI provider timed out.');
        }
        throw new AiError('provider', 'The AI provider could not be reached.');
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const status = response.status;
        await response.text().catch(() => '');
        if (status === 429) {
            throw new AiError('limit', 'The AI provider rate limit was reached.');
        }
        if (status === 401 || status === 403) {
            throw new AiError('config', 'The AI provider rejected the credentials.');
        }
        throw new AiError('provider', `The AI provider failed with status ${status}.`);
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new AiError('provider', 'The AI provider returned an unreadable response.');
    }

    const content = payload
        && payload.choices
        && payload.choices[0]
        && payload.choices[0].message
        && payload.choices[0].message.content;

    if (typeof content !== 'string' || content.trim() === '') {
        throw new AiError('provider', 'The AI provider returned an empty response.');
    }

    return content;
}

async function completeText(options) {
    if (providerName() === 'mock') {
        return mock.summarize(options.text);
    }
    return callOpenAi(Object.assign({}, options, { json: false }));
}

async function completeJson(options) {
    if (providerName() === 'mock') {
        return options.mock();
    }
    const raw = await callOpenAi(Object.assign({}, options, { json: true }));
    const parsed = extractJson(raw);
    if (!parsed) {
        throw new AiError('malformed', 'The AI provider returned invalid JSON.');
    }
    return parsed;
}

const summarizeNotes = (options) => {
    const built = prompts.summarize(options);
    return completeText({ system: built.system, user: built.user, text: options.text });
};

const generateQuiz = (options) => {
    const built = prompts.generateQuiz(options);
    return completeJson({
        system: built.system,
        user: built.user,
        mock: () => mock.generateQuiz(options.text, options),
    });
};

const gradeShortAnswers = (items) => {
    const built = prompts.gradeShortAnswers(items);
    return completeJson({
        system: built.system,
        user: built.user,
        mock: () => mock.gradeShortAnswers(items),
    });
};

module.exports = {
    AiError,
    providerName,
    completeText,
    completeJson,
    summarizeNotes,
    generateQuiz,
    gradeShortAnswers,
    extractJson,
    config: CONFIG,
};
