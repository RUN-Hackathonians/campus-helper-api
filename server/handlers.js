'use strict';

const core = require('../assets/js/quiz-core.js');
const ai = require('./ai');
const pdf = require('./pdf');
const { parseMultipart } = require('./multipart');
const { sendJson, readJsonBody } = require('./http-utils');

const TEXT_LIMIT = Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024; // multipart body ceiling
const JSON_LIMIT = 256 * 1024;
const MIN_TEXT_CHARS = 40;
const MAX_GRADE_ITEMS = 50;

class HttpError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function parseBool(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }
    const text = String(value == null ? '' : value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) {
        return true;
    }
    if (['false', '0', 'no', 'off'].includes(text)) {
        return false;
    }
    return fallback;
}

function clampCount(value) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) {
        return core.DEFAULTS.count;
    }
    return Math.min(core.LIMITS.maxCount, Math.max(core.LIMITS.minCount, parsed));
}

function parseTypes(value) {
    const raw = String(value == null ? '' : value).split(',');
    const types = raw
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => core.QUESTION_TYPES.includes(entry));
    const unique = Array.from(new Set(types));
    return unique.length > 0 ? unique : core.DEFAULTS.types.slice();
}

function parseDifficulty(value, fallback) {
    const text = String(value == null ? '' : value).toLowerCase();
    return core.DIFFICULTIES.includes(text) ? text : fallback;
}

/**
 * Resolve the study material from a multipart request. PDFs are validated and
 * their text extracted server-side; pasted text is length-checked.
 */
async function resolveSource(req) {
    const body = await require('./http-utils').readBody(req, TEXT_LIMIT).catch((error) => {
        if (error.code === 'too_large') {
            throw new HttpError(413, 'too_large', 'That file is too large.');
        }
        throw new HttpError(400, 'bad_request', 'Could not read the request.');
    });

    const parsed = parseMultipart(body, req.headers['content-type'] || '');
    const file = parsed.files.file;
    const pastedText = (parsed.fields.text || '').trim();
    const notices = [];

    let text = '';
    let mode = parsed.fields.mode === 'pdf' ? 'pdf' : 'text';

    if (file && file.data && file.data.length > 0) {
        mode = 'pdf';
        const looksPdf = /\.pdf$/i.test(file.name || '')
            || ['application/pdf', 'application/x-pdf'].includes((file.type || '').toLowerCase())
            || pdf.isPdf(file.data);
        if (!looksPdf) {
            throw new HttpError(415, 'unsupported_type', 'Please upload a PDF file.');
        }
        try {
            text = pdf.extractText(file.data);
        } catch (error) {
            if (error.code === 'no_text') {
                throw new HttpError(422, 'unreadable_pdf', 'No selectable text was found in that PDF. It may be a scanned image; try pasting the text instead.');
            }
            throw new HttpError(400, 'invalid_pdf', 'That PDF could not be read. Please try another file or paste the text.');
        }
    } else if (pastedText !== '') {
        mode = 'text';
        text = pastedText;
    }

    if (text.trim().length < MIN_TEXT_CHARS) {
        throw new HttpError(400, 'empty', 'Please add at least a few lines of notes (or a PDF with selectable text).');
    }

    if (text.length > core.LIMITS.maxSourceChars) {
        text = text.slice(0, core.LIMITS.maxSourceChars);
        notices.push(`Only the first ${core.LIMITS.maxSourceChars.toLocaleString()} characters were used.`);
    }

    return { text, mode, fields: parsed.fields, notices };
}

function aiErrorToHttp(error) {
    const kind = error && error.kind;
    if (kind === 'timeout') {
        return new HttpError(504, 'timeout', 'That took too long. Please try again.');
    }
    if (kind === 'limit') {
        return new HttpError(429, 'limit', "You've reached the current usage limit. Please try again later.");
    }
    if (kind === 'config') {
        return new HttpError(503, 'provider_config', 'The study service is not configured correctly.');
    }
    if (kind === 'malformed') {
        return new HttpError(502, 'malformed_ai', 'The study service returned an invalid response. Please try again.');
    }
    return new HttpError(502, 'provider', 'The study service had a problem. Please try again.');
}

async function handleProcess(req, res) {
    const source = await resolveSource(req);

    try {
        const summary = await ai.summarizeNotes({ text: source.text, mode: source.mode });
        const clean = typeof summary === 'string' ? summary.trim() : '';
        if (clean === '') {
            throw new HttpError(502, 'empty_summary', 'The summary came back empty. Please try again.');
        }
        sendJson(res, 200, { summary: clean, turns: [], followUp: null });
    } catch (error) {
        if (error instanceof HttpError) {
            throw error;
        }
        throw aiErrorToHttp(error);
    }
}

async function handleQuiz(req, res) {
    const source = await resolveSource(req);
    const fields = source.fields;

    const config = {
        count: clampCount(fields.count),
        types: parseTypes(fields.types),
        difficulty: parseDifficulty(fields.difficulty, core.DEFAULTS.difficulty),
        scope: String(fields.scope || 'entire').slice(0, 120),
        explanations: parseBool(fields.explanations, core.DEFAULTS.explanations),
    };

    let raw;
    try {
        raw = await ai.generateQuiz(Object.assign({ text: source.text, mode: source.mode }, config));
    } catch (error) {
        throw aiErrorToHttp(error);
    }

    const normalized = core.normalizeQuiz(raw, config);
    const notices = source.notices.slice();

    if (normalized.questions.length === 0) {
        throw new HttpError(422, 'insufficient_material', 'There was not enough usable material to build a quiz. Add more notes or choose different options and try again.');
    }

    if (normalized.questions.length < config.count) {
        notices.push(`Generated ${normalized.questions.length} reliable questions instead of ${config.count}.`);
    }

    // Strip anything that is not needed by the client; never leak raw model output.
    const questions = normalized.questions.map((question) => ({
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        options: question.options,
        correctOptionId: question.correctOptionId,
        correctBool: question.correctBool,
        expected: question.expected,
        acceptable: question.acceptable,
        explanation: question.explanation,
        source: question.source,
    }));

    sendJson(res, 200, {
        quiz: {
            title: normalized.title || 'Quiz',
            difficulty: config.difficulty,
            questions,
        },
        meta: {
            provider: ai.providerName(),
            requested: config.count,
            generated: questions.length,
            notices,
        },
    });
}

async function handleGrade(req, res) {
    let body;
    try {
        body = await readJsonBody(req, JSON_LIMIT);
    } catch (error) {
        throw new HttpError(400, 'invalid_json', 'Could not read the grading request.');
    }

    const items = Array.isArray(body && body.items) ? body.items.slice(0, MAX_GRADE_ITEMS) : [];
    if (items.length === 0) {
        throw new HttpError(400, 'empty', 'No answers were provided to grade.');
    }

    const clean = [];
    for (const item of items) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const id = String(item.id || '').slice(0, 32);
        const answer = String(item.answer || '').slice(0, 2000);
        const expected = String(item.expected || '').slice(0, 2000);
        if (id === '' || answer.trim() === '' || expected.trim() === '') {
            continue;
        }
        clean.push({
            id,
            question: String(item.question || '').slice(0, 2000),
            expected,
            acceptable: Array.isArray(item.acceptable)
                ? item.acceptable.slice(0, 10).map((value) => String(value).slice(0, 200))
                : [],
            answer,
        });
    }

    if (clean.length === 0) {
        throw new HttpError(400, 'empty', 'No gradeable short answers were provided.');
    }

    const gradeLocally = () => clean.map((item) => {
        const local = core.gradeShortAnswer(item.answer, item.expected, item.acceptable);
        return {
            id: item.id,
            correct: local.correct,
            confidence: local.score,
            method: 'local',
            rationale: 'Compared your answer with the expected answer.',
        };
    });

    let results;
    if (ai.providerName() !== 'openai') {
        // Offline: use the same fuzzy matcher as the client for consistency.
        results = gradeLocally();
    } else {
        try {
            const graded = await ai.gradeShortAnswers(clean);
            results = normalizeGradeResults(graded, clean, 'ai');
        } catch {
            results = gradeLocally();
        }
    }

    sendJson(res, 200, { results });
}

function normalizeGradeResults(graded, items, method) {
    const usedMethod = method === 'ai' ? 'ai' : 'local';
    const byId = new Map();
    const raw = Array.isArray(graded && graded.results) ? graded.results : [];
    raw.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
            return;
        }
        byId.set(String(entry.id), entry);
    });

    return items.map((item) => {
        const entry = byId.get(item.id);
        if (entry && typeof entry.correct === 'boolean') {
            const confidence = Number(entry.confidence);
            return {
                id: item.id,
                correct: entry.correct,
                confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
                method: usedMethod,
                rationale: String(entry.rationale || '').slice(0, 400)
                    || 'Judged as semantically correct or incorrect against the expected answer.',
            };
        }
        const local = core.gradeShortAnswer(item.answer, item.expected, item.acceptable);
        return {
            id: item.id,
            correct: local.correct,
            confidence: local.score,
            method: 'local',
            rationale: 'Compared your answer with the expected answer.',
        };
    });
}

module.exports = { handleProcess, handleQuiz, handleGrade, HttpError, resolveSource };
