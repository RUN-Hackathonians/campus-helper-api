/**
 * campus_helper quiz core.
 *
 * Pure, dependency-free quiz logic shared by the browser UI, the Node backend
 * and the test suite. It must never touch the DOM or the network.
 *
 * Loaded two ways:
 *   - browser: <script src="assets/js/quiz-core.js"> exposes CampusHelperQuizCore
 *   - node:    require('../assets/js/quiz-core.js')
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CampusHelperQuizCore = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const QUESTION_TYPES = ['mcq', 'truefalse', 'short'];
    const ALLOWED_COUNTS = [5, 10, 15, 20];
    const DIFFICULTIES = ['easy', 'medium', 'hard'];

    const LIMITS = {
        minCount: 1,
        maxCount: 30,
        defaultCount: 10,
        maxSourceChars: 40000,
        maxOptionLength: 400,
        minOptions: 2,
        maxOptions: 6,
    };

    const DEFAULTS = {
        count: LIMITS.defaultCount,
        types: ['mcq'],
        difficulty: 'medium',
        scope: 'entire',
        explanations: true,
        practice: false,
    };

    const STOPWORDS = new Set([
        'a', 'an', 'the', 'of', 'to', 'and', 'or', 'is', 'are', 'was', 'were', 'be',
        'been', 'being', 'in', 'on', 'at', 'for', 'with', 'that', 'this', 'these',
        'those', 'it', 'its', 'as', 'by', 'from', 'into', 'than', 'then', 'so',
        'such', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
        'must', 'do', 'does', 'did', 'has', 'have', 'had', 'not', 'no', 'but', 'if',
        'when', 'while', 'which', 'who', 'whom', 'whose', 'what', 'where', 'how',
    ]);

    const TYPE_ALIASES = {
        mcq: ['mcq', 'multiplechoice', 'choice', 'singlechoice', 'single', 'multiple'],
        truefalse: ['truefalse', 'tf', 'boolean', 'bool', 'trueorfalse'],
        short: ['short', 'shortanswer', 'open', 'openended', 'text', 'fill', 'fillintheblank', 'blank'],
    };

    const asString = (value) => (typeof value === 'string' ? value.trim() : '');

    const canonicalType = (raw) => {
        const key = asString(raw).toLowerCase().replace(/[^a-z]/g, '');
        if (key === '') {
            return null;
        }
        for (const type of QUESTION_TYPES) {
            if (TYPE_ALIASES[type].includes(key)) {
                return type;
            }
        }
        return null;
    };

    const normalizeText = (value) => asString(value)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokenize = (value) => normalizeText(value)
        .split(' ')
        .filter((word) => word.length > 0 && !STOPWORDS.has(word));

    const toSet = (tokens) => new Set(tokens);

    const intersectionSize = (a, b) => {
        let count = 0;
        a.forEach((token) => {
            if (b.has(token)) {
                count += 1;
            }
        });
        return count;
    };

    /**
     * Token-based similarity in [0, 1]. Deliberately conservative so short answers
     * are only auto-marked correct when the wording genuinely overlaps.
     */
    const similarity = (answer, expected) => {
        const a = toSet(tokenize(answer));
        const b = toSet(tokenize(expected));
        if (a.size === 0 || b.size === 0) {
            return 0;
        }
        if (normalizeText(answer) === normalizeText(expected)) {
            return 1;
        }
        const shared = intersectionSize(a, b);
        const jaccard = shared / (a.size + b.size - shared);
        const coverageOfExpected = shared / b.size;
        return Math.max(jaccard, coverageOfExpected);
    };

    /** Fraction of the expected answer's key words that appear in the answer. */
    const similarityCoverage = (answer, expected) => {
        const a = toSet(tokenize(answer));
        const b = toSet(tokenize(expected));
        if (a.size === 0 || b.size === 0) {
            return 0;
        }
        return intersectionSize(a, b) / b.size;
    };

    const SIMILARITY_THRESHOLD = 0.7;
    const COVERAGE_THRESHOLD = 0.6;

    /**
     * Compare a free-text answer with the expected answer and any accepted
     * alternatives. Returns a confidence score; callers decide the threshold.
     */
    const gradeShortAnswer = (answer, expected, acceptable) => {
        const cleanAnswer = asString(answer);
        const cleanExpected = asString(expected);
        if (cleanAnswer === '' || cleanExpected === '') {
            return { correct: false, score: 0, method: 'local' };
        }

        const candidates = [cleanExpected].concat(
            Array.isArray(acceptable) ? acceptable.map(asString).filter(Boolean) : []
        );

        let best = 0;
        let coverage = 0;
        let matched = false;
        const answerNorm = normalizeText(cleanAnswer);
        candidates.forEach((candidate) => {
            const score = similarity(cleanAnswer, candidate);
            best = Math.max(best, score);
            coverage = Math.max(coverage, similarityCoverage(cleanAnswer, candidate));
            const candidateNorm = normalizeText(candidate);
            if (answerNorm !== '' && (answerNorm === candidateNorm
                || answerNorm.includes(candidateNorm)
                || candidateNorm.includes(answerNorm))) {
                matched = true;
            }
        });

        const correct = matched || best >= SIMILARITY_THRESHOLD || coverage >= COVERAGE_THRESHOLD;
        return { correct, score: Number(Math.max(best, coverage).toFixed(2)), method: 'local' };
    };

    const readOptionText = (option) => {
        if (typeof option === 'string') {
            return asString(option);
        }
        if (option && typeof option === 'object') {
            return asString(option.text || option.label || option.value || option.answer || option.option);
        }
        return '';
    };

    const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

    const buildOptions = (raw) => {
        const source = Array.isArray(raw) ? raw : [];
        const options = [];
        const seen = new Set();

        for (const entry of source) {
            const text = readOptionText(entry).slice(0, LIMITS.maxOptionLength);
            const key = normalizeText(text);
            if (text === '' || seen.has(key)) {
                continue;
            }
            seen.add(key);
            options.push({ id: OPTION_IDS[options.length], text });
        }

        return options;
    };

    const resolveCorrectIndex = (question, options) => {
        const indexCandidates = [
            question.correctIndex,
            question.correct_index,
            question.answerIndex,
            question.answer_index,
            question.correctOptionIndex,
        ];
        for (const candidate of indexCandidates) {
            const index = Number(candidate);
            if (Number.isInteger(index) && index >= 0 && index < options.length) {
                return index;
            }
        }

        const idCandidates = [question.correctOptionId, question.correct_option_id];
        for (const candidate of idCandidates) {
            const id = asString(candidate).toLowerCase();
            const found = options.findIndex((option) => option.id === id);
            if (found !== -1) {
                return found;
            }
        }

        const textCandidates = [
            question.correctAnswer,
            question.correct_answer,
            question.answer,
            question.correct,
            typeof question.correctOption === 'string' ? question.correctOption : '',
        ];
        for (const candidate of textCandidates) {
            const text = asString(candidate);
            if (text === '') {
                continue;
            }
            const numeric = Number(text);
            if (Number.isInteger(numeric) && numeric >= 0 && numeric < options.length) {
                return numeric;
            }
            const target = normalizeText(text);
            const found = options.findIndex((option) => normalizeText(option.text) === target);
            if (found !== -1) {
                return found;
            }
        }

        return -1;
    };

    const readExplanation = (question, keep) => {
        if (!keep) {
            return null;
        }
        return asString(question.explanation || question.rationale || question.reason) || null;
    };

    const readSource = (question) => asString(
        question.topic || question.source || question.section || question.sourceTopic
    ) || null;

    const normalizeQuestion = (raw, keepExplanations) => {
        if (!raw || typeof raw !== 'object') {
            return { error: 'not-an-object' };
        }

        const type = canonicalType(raw.type || raw.questionType || raw.kind);
        if (!type) {
            return { error: 'missing-type' };
        }

        const prompt = asString(raw.question || raw.prompt || raw.text || raw.stem);
        if (prompt === '') {
            return { error: 'missing-prompt' };
        }

        const base = {
            type,
            prompt,
            explanation: readExplanation(raw, keepExplanations),
            source: readSource(raw),
        };

        if (type === 'mcq') {
            const options = buildOptions(raw.options || raw.choices || raw.answers);
            if (options.length < LIMITS.minOptions) {
                return { error: 'too-few-options' };
            }
            const correctIndex = resolveCorrectIndex(raw, options);
            if (correctIndex === -1) {
                return { error: 'no-correct-option' };
            }
            return {
                question: Object.assign(base, {
                    options,
                    correctOptionId: options[correctIndex].id,
                    correctBool: null,
                    expected: null,
                    acceptable: [],
                }),
            };
        }

        if (type === 'truefalse') {
            const rawBool = raw.answerBool ?? raw.correctBool ?? raw.correct ?? raw.answer;
            let correctBool = null;
            if (typeof rawBool === 'boolean') {
                correctBool = rawBool;
            } else {
                const text = asString(rawBool).toLowerCase();
                if (['true', 't', 'yes', 'y', 'correct'].includes(text)) {
                    correctBool = true;
                } else if (['false', 'f', 'no', 'n', 'incorrect'].includes(text)) {
                    correctBool = false;
                }
            }
            if (correctBool === null) {
                return { error: 'no-true-false-answer' };
            }
            return {
                question: Object.assign(base, {
                    options: null,
                    correctOptionId: null,
                    correctBool,
                    expected: null,
                    acceptable: [],
                }),
            };
        }

        const expected = asString(
            raw.expected || raw.answer || raw.correctAnswer || raw.correct_answer
            || raw.sampleAnswer || raw.sample_answer || raw.reference
        );
        if (expected === '') {
            return { error: 'no-expected-answer' };
        }

        const rawAcceptable = raw.acceptableAnswers || raw.acceptable_answers
            || raw.acceptable || raw.alternatives || raw.synonyms || [];
        const acceptable = (Array.isArray(rawAcceptable) ? rawAcceptable : [])
            .map(asString)
            .filter(Boolean)
            .slice(0, 10);

        return {
            question: Object.assign(base, {
                options: null,
                correctOptionId: null,
                correctBool: null,
                expected,
                acceptable,
            }),
        };
    };

    /**
     * Validate and canonicalise raw AI output. Malformed questions are dropped
     * (with a reason) rather than rendered, so the UI never shows broken data.
     */
    const normalizeQuiz = (raw, options) => {
        const config = Object.assign({}, DEFAULTS, options || {});
        // Only filter by question type when the caller explicitly asks for types.
        const requestedTypes = options && Array.isArray(options.types) ? options.types : null;
        const allowedTypes = requestedTypes && requestedTypes.length > 0
            ? requestedTypes.filter((type) => QUESTION_TYPES.includes(type))
            : QUESTION_TYPES.slice();

        const payload = Array.isArray(raw) ? { questions: raw } : (raw || {});
        const input = Array.isArray(payload.questions) ? payload.questions : [];

        const questions = [];
        const dropped = [];
        const seen = new Set();

        for (const item of input) {
            const result = normalizeQuestion(item, config.explanations !== false);
            if (result.error) {
                dropped.push({ reason: result.error, prompt: asString(item && (item.question || item.prompt)) });
                continue;
            }

            const question = result.question;
            if (!allowedTypes.includes(question.type)) {
                dropped.push({ reason: 'type-not-requested', prompt: question.prompt });
                continue;
            }

            const dedupeKey = normalizeText(question.prompt);
            if (seen.has(dedupeKey)) {
                dropped.push({ reason: 'duplicate', prompt: question.prompt });
                continue;
            }
            seen.add(dedupeKey);

            question.id = 'q' + (questions.length + 1);
            questions.push(question);

            if (questions.length >= config.count) {
                break;
            }
        }

        return {
            title: asString(payload.title || payload.quizTitle) || null,
            topic: asString(payload.topic) || null,
            difficulty: asString(payload.difficulty) || config.difficulty,
            questions,
            dropped,
        };
    };

    const isAnswered = (type, response) => {
        if (!response || typeof response !== 'object') {
            return false;
        }
        if (type === 'mcq') {
            return asString(response.optionId) !== '';
        }
        if (type === 'truefalse') {
            return typeof response.bool === 'boolean';
        }
        return asString(response.text) !== '';
    };

    /**
     * Grade every question locally. Objective questions are exact; short answers
     * use fuzzy matching. Unanswered questions are tracked separately.
     */
    const gradeQuiz = (quiz, responses) => {
        const answers = responses && typeof responses === 'object' ? responses : {};
        const list = Array.isArray(quiz && quiz.questions) ? quiz.questions : [];

        const perQuestion = list.map((question) => {
            const response = answers[question.id];
            if (!isAnswered(question.type, response)) {
                return { id: question.id, type: question.type, status: 'unanswered', correct: false, score: 0 };
            }

            if (question.type === 'mcq') {
                const correct = response.optionId === question.correctOptionId;
                return { id: question.id, type: question.type, status: correct ? 'correct' : 'incorrect', correct, score: correct ? 1 : 0 };
            }

            if (question.type === 'truefalse') {
                const correct = response.bool === question.correctBool;
                return { id: question.id, type: question.type, status: correct ? 'correct' : 'incorrect', correct, score: correct ? 1 : 0 };
            }

            const graded = gradeShortAnswer(response.text, question.expected, question.acceptable);
            return {
                id: question.id,
                type: question.type,
                status: graded.correct ? 'correct' : 'incorrect',
                correct: graded.correct,
                score: graded.score,
            };
        });

        const total = list.length;
        const correct = perQuestion.filter((item) => item.status === 'correct').length;
        const unanswered = perQuestion.filter((item) => item.status === 'unanswered').length;
        const incorrect = total - correct - unanswered;
        const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);

        return { total, correct, incorrect, unanswered, percentage, perQuestion };
    };

    return {
        QUESTION_TYPES,
        ALLOWED_COUNTS,
        DIFFICULTIES,
        LIMITS,
        DEFAULTS,
        normalizeText,
        tokenize,
        similarity,
        gradeShortAnswer,
        normalizeQuiz,
        gradeQuiz,
        gradeShortAnswers: gradeShortAnswer,
    };
});
