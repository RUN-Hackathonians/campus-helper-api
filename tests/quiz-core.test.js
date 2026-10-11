'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../assets/js/quiz-core.js');

test('normalizeQuiz maps MCQ correct answer given by text', () => {
    const quiz = core.normalizeQuiz({
        title: 'Cells',
        questions: [{
            type: 'multiple choice',
            question: 'Which organelle produces energy?',
            options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
            correctAnswer: 'Mitochondria',
            explanation: 'Mitochondria generate ATP.',
            topic: 'Cell biology',
        }],
    });

    assert.equal(quiz.questions.length, 1);
    const q = quiz.questions[0];
    assert.equal(q.type, 'mcq');
    assert.equal(q.options.length, 4);
    assert.equal(q.correctOptionId, 'b');
    assert.equal(q.explanation, 'Mitochondria generate ATP.');
    assert.equal(q.source, 'Cell biology');
});

test('normalizeQuiz maps MCQ correct answer given by index', () => {
    const quiz = core.normalizeQuiz({
        questions: [{
            type: 'mcq',
            question: '2 + 2 = ?',
            options: ['3', '4', '5'],
            correctIndex: 1,
        }],
    });
    assert.equal(quiz.questions[0].correctOptionId, 'b');
});

test('normalizeQuiz drops malformed questions with reasons', () => {
    const quiz = core.normalizeQuiz({
        questions: [
            { type: 'mcq', question: 'No answer', options: ['a', 'b'] },
            { type: 'mcq', question: 'One option', options: ['only'], correctAnswer: 'only' },
            { type: 'short', question: 'No expected' },
            null,
        ],
    });
    assert.equal(quiz.questions.length, 0);
    assert.deepEqual(quiz.dropped.map((d) => d.reason), [
        'no-correct-option',
        'too-few-options',
        'no-expected-answer',
        'not-an-object',
    ]);
});

test('normalizeQuiz removes duplicate questions', () => {
    const question = {
        type: 'truefalse',
        question: 'Water boils at 100C at sea level.',
        answerBool: true,
    };
    const quiz = core.normalizeQuiz({ questions: [question, Object.assign({}, question)] });
    assert.equal(quiz.questions.length, 1);
    assert.equal(quiz.dropped[0].reason, 'duplicate');
});

test('normalizeQuiz parses true/false answers in several shapes', () => {
    const quiz = core.normalizeQuiz({
        questions: [
            { type: 'true/false', question: 'Sky is green.', answer: 'false' },
            { type: 'boolean', question: 'Fire is hot.', correct: true },
        ],
    });
    assert.equal(quiz.questions[0].correctBool, false);
    assert.equal(quiz.questions[1].correctBool, true);
});

test('normalizeQuiz keeps short-answer alternatives and enforces type filter', () => {
    const raw = {
        questions: [
            { type: 'short', question: 'Define osmosis', expected: 'movement of water', acceptable: ['water diffusion'] },
            { type: 'mcq', question: 'Pick', options: ['a', 'b'], correctAnswer: 'a' },
        ],
    };
    const onlyShort = core.normalizeQuiz(raw, { types: ['short'] });
    assert.equal(onlyShort.questions.length, 1);
    assert.deepEqual(onlyShort.questions[0].acceptable, ['water diffusion']);
    assert.ok(onlyShort.dropped.some((d) => d.reason === 'type-not-requested'));
});

test('normalizeQuiz caps question count and strips explanations when disabled', () => {
    const questions = [];
    for (let i = 0; i < 12; i += 1) {
        questions.push({
            type: 'truefalse',
            question: `Statement number ${i} is being tested here.`,
            answerBool: i % 2 === 0,
            explanation: 'because',
        });
    }
    const quiz = core.normalizeQuiz({ questions }, { count: 5, types: ['truefalse'], explanations: false });
    assert.equal(quiz.questions.length, 5);
    assert.equal(quiz.questions[0].explanation, null);
});

test('gradeShortAnswer accepts exact and semantically close answers', () => {
    assert.equal(core.gradeShortAnswer('mitochondria', 'Mitochondria', []).correct, true);
    const close = core.gradeShortAnswer(
        'Water moves across a membrane from high to low concentration',
        'water movement across a membrane by diffusion',
        []
    );
    assert.equal(close.correct, true);
    assert.equal(core.gradeShortAnswer('photosynthesis', 'mitochondria', []).correct, false);
});

test('gradeQuiz scores objective, short and unanswered questions', () => {
    const quiz = {
        questions: [
            { id: 'q1', type: 'mcq', correctOptionId: 'b', options: [] },
            { id: 'q2', type: 'truefalse', correctBool: true },
            { id: 'q3', type: 'short', expected: 'mitochondria', acceptable: ['the mitochondria'] },
            { id: 'q4', type: 'mcq', correctOptionId: 'a', options: [] },
        ],
    };
    const result = core.gradeQuiz(quiz, {
        q1: { optionId: 'b' },
        q2: { bool: false },
        q3: { text: 'mitochondria produce energy' },
    });

    assert.equal(result.total, 4);
    assert.equal(result.correct, 2);
    assert.equal(result.incorrect, 1);
    assert.equal(result.unanswered, 1);
    assert.equal(result.percentage, 50);
    assert.equal(result.perQuestion.find((q) => q.id === 'q4').status, 'unanswered');
});

test('gradeQuiz handles an empty quiz', () => {
    const result = core.gradeQuiz({ questions: [] }, {});
    assert.deepEqual(
        { total: result.total, correct: result.correct, percentage: result.percentage },
        { total: 0, correct: 0, percentage: 0 }
    );
});
