/**
 * API layer for campus_helper.
 * All backend communication lives here so it can be changed in one place.
 */
const CampusHelperApi = (() => {
    'use strict';

    const CONFIG = {
        // Swap this for the real backend route when it is available.
        endpoint: '/api/process',
        quizEndpoint: '/api/quiz',
        gradeEndpoint: '/api/grade',
        method: 'POST',
        timeoutMs: 60000,
        quizTimeoutMs: 90000,
        gradeTimeoutMs: 30000,
        // Client-side guard only. Keep in sync with the backend upload limit.
        maxFileBytes: 20 * 1024 * 1024,
    };

    const RESULT_KEYS = ['summary', 'result', 'output', 'answer', 'text', 'content', 'data', 'response'];

    /**
     * The contract this frontend expects. Kept as data so it can be inspected while
     * the backend is being built.
     */
    const CONTRACT = {
        endpoint: `${CONFIG.method} ${CONFIG.endpoint}`,
        request: {
            contentType: 'multipart/form-data (boundary set by the browser)',
            fields: {
                file: 'application/pdf, optional, the uploaded lecture notes',
                text: 'utf-8 text, optional, the pasted lecture notes',
                mode: '"pdf" when a file was submitted, otherwise "text"',
            },
        },
        response: {
            summary: 'string (markdown), required',
            turns: 'array of { role: "user" | "assistant", content: string }, optional',
            followUp: 'object { question: string, options: string[] }, optional',
        },
        errors: {
            400: 'invalid input (for example an unreadable PDF)',
            413: 'file larger than the server limit',
            415: 'unsupported file type',
            429: 'usage limit reached',
        },
    };

    class ApiError extends Error {
        constructor(kind, message, status) {
            super(message);
            this.name = 'ApiError';
            this.kind = kind;
            this.status = status;
        }
    }

    const isLimitPayload = (status, payload) => {
        if (status === 429) {
            return true;
        }

        if (!payload || typeof payload !== 'object') {
            return false;
        }

        const code = String(payload.code ?? payload.error ?? payload.status ?? '').toLowerCase();
        const limitCodes = ['limit_reached', 'rate_limit', 'rate_limit_exceeded', 'quota_exceeded', 'too_many_requests', '429'];
        if (limitCodes.includes(code)) {
            return true;
        }

        const message = String(payload.message ?? payload.detail ?? '').toLowerCase();
        return /\b(usage limit|rate limit|quota|too many requests|limit reached)\b/.test(message);
    };

    const extractResult = (payload) => {
        if (payload == null) {
            return '';
        }

        if (typeof payload === 'string') {
            return payload;
        }

        if (typeof payload !== 'object') {
            return String(payload);
        }

        for (const key of RESULT_KEYS) {
            const value = payload[key];
            if (typeof value === 'string' && value.trim() !== '') {
                return value;
            }
        }

        return '';
    };

    const normaliseTurns = (turns) => {
        if (!Array.isArray(turns)) {
            return [];
        }

        return turns
            .filter((turn) => turn && typeof turn.content === 'string' && turn.content.trim() !== '')
            .map((turn) => ({
                role: turn.role === 'user' ? 'user' : 'assistant',
                content: turn.content,
            }));
    };

    const normaliseFollowUp = (followUp) => {
        if (!followUp || typeof followUp !== 'object') {
            return null;
        }

        const question = typeof followUp.question === 'string' ? followUp.question.trim() : '';
        if (question === '') {
            return null;
        }

        const options = Array.isArray(followUp.options)
            ? followUp.options.filter((option) => typeof option === 'string' && option.trim() !== '')
            : [];

        return { question, options };
    };

    const readPayload = async (response) => {
        const raw = await response.text();
        if (raw.trim() === '') {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    };

    const kindForStatus = (status) => {
        if (status === 413) {
            return 'too-large';
        }

        if (status === 400 || status === 415 || status === 422) {
            return 'invalid';
        }

        return 'server';
    };

    const request = async (input) => {
        const { file = null, text = '', mode = 'text' } = input || {};

        const body = new FormData();
        if (file) {
            body.append('file', file, file.name);
        }
        if (text) {
            body.append('text', text);
        }
        body.append('mode', mode);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

        let response;
        try {
            // No Content-Type header: the browser must add the multipart boundary.
            response = await fetch(CONFIG.endpoint, {
                method: CONFIG.method,
                body,
                signal: controller.signal,
            });
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new ApiError('timeout', 'The request timed out.', 0);
            }
            throw new ApiError('network', 'The backend could not be reached.', 0);
        } finally {
            clearTimeout(timer);
        }

        const payload = await readPayload(response);

        if (!response.ok) {
            const kind = isLimitPayload(response.status, payload) ? 'limit' : kindForStatus(response.status);
            throw new ApiError(kind, `Request failed with status ${response.status}.`, response.status);
        }

        if (isLimitPayload(response.status, payload)) {
            throw new ApiError('limit', 'Usage limit reached.', response.status);
        }

        const summary = extractResult(payload);
        if (summary.trim() === '') {
            throw new ApiError('empty', 'The backend returned no summary.', response.status);
        }

        return {
            summary,
            turns: normaliseTurns(payload && payload.turns),
            followUp: normaliseFollowUp(payload && payload.followUp),
        };
    };

    const performFetch = async (url, init, timeoutMs) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response;
        try {
            response = await fetch(url, Object.assign({ method: CONFIG.method, signal: controller.signal }, init));
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new ApiError('timeout', 'The request timed out.', 0);
            }
            throw new ApiError('network', 'The backend could not be reached.', 0);
        } finally {
            clearTimeout(timer);
        }

        const payload = await readPayload(response);

        if (!response.ok) {
            const kind = isLimitPayload(response.status, payload) ? 'limit' : kindForStatus(response.status);
            const message = payload && typeof payload === 'object' && typeof payload.message === 'string'
                ? payload.message
                : `Request failed with status ${response.status}.`;
            throw new ApiError(kind, message, response.status);
        }

        if (isLimitPayload(response.status, payload)) {
            throw new ApiError('limit', 'Usage limit reached.', response.status);
        }

        return payload;
    };

    const buildSourceForm = (input, extra) => {
        const { file = null, text = '', mode = 'text' } = input || {};
        const body = new FormData();
        if (file) {
            body.append('file', file, file.name);
        }
        if (text) {
            body.append('text', text);
        }
        body.append('mode', mode);
        Object.keys(extra || {}).forEach((key) => {
            const value = extra[key];
            if (value !== undefined && value !== null) {
                body.append(key, String(value));
            }
        });
        return body;
    };

    const validateQuizPayload = (payload, config) => {
        const raw = payload && payload.quiz ? payload.quiz : payload;
        const core = typeof window !== 'undefined' ? window.CampusHelperQuizCore : null;
        const options = {
            count: config.count,
            types: config.types,
            explanations: config.explanations !== false,
        };

        let quiz = null;
        if (core && typeof core.normalizeQuiz === 'function') {
            const normalized = core.normalizeQuiz(raw, options);
            if (normalized.questions.length > 0) {
                quiz = {
                    title: normalized.title || (raw && raw.title) || 'Quiz',
                    difficulty: normalized.difficulty || config.difficulty,
                    questions: normalized.questions,
                };
            }
        } else if (raw && Array.isArray(raw.questions) && raw.questions.length > 0) {
            quiz = { title: raw.title || 'Quiz', difficulty: raw.difficulty || config.difficulty, questions: raw.questions };
        }

        if (!quiz) {
            throw new ApiError('empty', 'The quiz came back empty or unreadable. Please try again.', 200);
        }

        const meta = payload && payload.meta && typeof payload.meta === 'object'
            ? payload.meta
            : { requested: config.count, generated: quiz.questions.length, notices: [] };

        if (!Array.isArray(meta.notices)) {
            meta.notices = [];
        }

        return { quiz, meta };
    };

    const generateQuiz = async (input) => {
        const config = (input && input.config) || {};
        const extra = {
            count: config.count,
            types: Array.isArray(config.types) ? config.types.join(',') : config.types,
            difficulty: config.difficulty,
            scope: config.scope || 'entire',
            explanations: config.explanations === false ? 'false' : 'true',
        };

        const payload = await performFetch(CONFIG.quizEndpoint, { body: buildSourceForm(input, extra) }, CONFIG.quizTimeoutMs);
        return validateQuizPayload(payload, config);
    };

    const gradeShortAnswers = async (items) => {
        const payload = await performFetch(CONFIG.gradeEndpoint, {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
        }, CONFIG.gradeTimeoutMs);

        const results = payload && Array.isArray(payload.results) ? payload.results : [];
        return results
            .filter((result) => result && typeof result.id === 'string')
            .map((result) => {
                const confidence = Number(result.confidence);
                return {
                    id: result.id,
                    correct: result.correct === true,
                    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
                    method: result.method === 'ai' ? 'ai' : 'local',
                    rationale: typeof result.rationale === 'string' ? result.rationale : '',
                };
            });
    };

    return {
        processNotes: request,
        generateQuiz,
        gradeShortAnswers,
        contract: CONTRACT,
        endpoint: CONFIG.endpoint,
        quizEndpoint: CONFIG.quizEndpoint,
        gradeEndpoint: CONFIG.gradeEndpoint,
        maxFileBytes: CONFIG.maxFileBytes,
    };
})();

// Uncomment while wiring up the backend to see the exact shapes this page expects.
// window.addEventListener('load', () => console.table(CampusHelperApi.contract));
