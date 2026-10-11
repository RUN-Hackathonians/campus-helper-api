'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dom = require('./dom.js');
dom.install();
global.window = global;
global.CampusHelperQuizCore = require('../assets/js/quiz-core.js');

const Quiz = require('../assets/js/quiz-ui.js');

const QUIZ = {
    title: 'Biology quiz',
    difficulty: 'medium',
    questions: [
        {
            id: 'q1',
            type: 'mcq',
            prompt: 'Which organelle produces most of the cell energy?',
            options: [
                { id: 'a', text: 'Nucleus' },
                { id: 'b', text: 'Mitochondria' },
                { id: 'c', text: 'Ribosome' },
            ],
            correctOptionId: 'b',
            correctBool: null,
            expected: null,
            acceptable: [],
            explanation: 'Mitochondria generate ATP.',
            source: 'Cells',
        },
        {
            id: 'q2',
            type: 'truefalse',
            prompt: 'Water boils at 100 degrees Celsius at sea level.',
            options: null,
            correctOptionId: null,
            correctBool: true,
            expected: null,
            acceptable: [],
            explanation: null,
            source: null,
        },
        {
            id: 'q3',
            type: 'short',
            prompt: 'Define osmosis.',
            options: null,
            correctOptionId: null,
            correctBool: null,
            expected: 'water movement across a membrane',
            acceptable: ['diffusion of water'],
            explanation: 'Water moves down its concentration gradient.',
            source: null,
        },
    ],
};

const click = (element) => element.dispatchEvent({ type: 'click', preventDefault() {} });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function mount(overrides) {
    const root = dom.createElement('div');
    const controller = Quiz.create(Object.assign({
        root,
        quiz: QUIZ,
        explanations: true,
        practice: false,
        grader: async () => [],
    }, overrides || {}));
    return { root, controller };
}

function radioByValue(root, value) {
    return root.querySelectorAll('input').find((input) => input.getAttribute('value') === value);
}

test('renders the first question with a counter and progress', () => {
    const { root } = mount();
    assert.equal(root.querySelector('#quiz-question').textContent, QUIZ.questions[0].prompt);
    assert.equal(root.querySelector('.quiz__counter').textContent, 'Question 1 of 3');
    assert.equal(root.querySelectorAll('.quiz__dot').length, 3);
});

test('selecting an option marks the question answered and supports navigation', () => {
    const { root } = mount();

    const correct = radioByValue(root, 'b');
    correct.checked = true;
    correct.dispatchEvent({ type: 'change' });

    const firstDot = root.querySelector('button[data-index="0"]');
    assert.equal(firstDot.classList.contains('quiz__dot--answered'), true);

    click(root.querySelector('#quiz-next'));
    assert.equal(root.querySelector('.quiz__counter').textContent, 'Question 2 of 3');

    click(root.querySelector('#quiz-prev'));
    assert.equal(root.querySelector('.quiz__counter').textContent, 'Question 1 of 3');
});

test('true/false and short answers can be recorded, and unanswered questions are counted', () => {
    const { root } = mount();

    const mcq = radioByValue(root, 'b');
    mcq.checked = true;
    mcq.dispatchEvent({ type: 'change' });

    click(root.querySelector('#quiz-next'));
    const trueInput = radioByValue(root, 'true');
    trueInput.checked = true;
    trueInput.dispatchEvent({ type: 'change' });

    click(root.querySelector('#quiz-next'));
    const textarea = root.querySelector('textarea');
    textarea.value = 'movement of water across a membrane';
    textarea.dispatchEvent({ type: 'input' });

    assert.equal(root.querySelector('#quiz-status').textContent, 'All questions answered.');
    assert.equal(root.querySelectorAll('.quiz__dot--answered').length, 3);
});

test('submission shows a confirmation, grades locally and renders results', async () => {
    const { root } = mount();

    // q1 correct, q2 answered correctly, q3 left unanswered.
    const correct = radioByValue(root, 'b');
    correct.checked = true;
    correct.dispatchEvent({ type: 'change' });
    click(root.querySelector('#quiz-next'));
    const trueInput = radioByValue(root, 'true');
    trueInput.checked = true;
    trueInput.dispatchEvent({ type: 'change' });

    click(root.querySelector('#quiz-submit'));
    assert.ok(root.querySelector('#quiz-confirm-yes'), 'confirmation step is shown');

    click(root.querySelector('#quiz-confirm-yes'));
    await tick();

    assert.equal(root.querySelector('.results__percentage').textContent, '67%');
    assert.equal(root.querySelectorAll('.review__item').length, 3);
    assert.ok(root.querySelector('.review__item--unanswered'), 'unanswered question is flagged');
});

test('short answers are refined by the server grader and flagged as AI-graded', async () => {
    const grader = async (items) => items.map((item) => ({
        id: item.id,
        correct: true,
        confidence: 0.9,
        method: 'ai',
        rationale: 'Semantically correct.',
    }));

    const { root } = mount({ grader });

    // Answer q1 and q2 correctly, and give a short answer for q3.
    radioByValue(root, 'b').checked = true;
    radioByValue(root, 'b').dispatchEvent({ type: 'change' });
    click(root.querySelector('#quiz-next'));
    radioByValue(root, 'true').checked = true;
    radioByValue(root, 'true').dispatchEvent({ type: 'change' });
    click(root.querySelector('#quiz-next'));
    const textarea = root.querySelector('textarea');
    textarea.value = 'water diffusing across a membrane';
    textarea.dispatchEvent({ type: 'input' });

    click(root.querySelector('#quiz-submit'));
    click(root.querySelector('#quiz-confirm-yes'));
    await tick();

    assert.equal(root.querySelector('.results__percentage').textContent, '100%');
    assert.match(root.textContent, /graded by AI/i);
});

test('practice mode reveals feedback immediately', () => {
    const { root } = mount({ practice: true });
    const wrong = radioByValue(root, 'a');
    wrong.checked = true;
    wrong.dispatchEvent({ type: 'change' });

    const feedback = root.querySelector('.quiz-feedback');
    assert.ok(feedback, 'feedback is shown in practice mode');
    assert.equal(feedback.classList.contains('quiz-feedback--incorrect'), true);
});

test('retry clears answers and returns to the first question', async () => {
    const { root } = mount();

    radioByValue(root, 'b').checked = true;
    radioByValue(root, 'b').dispatchEvent({ type: 'change' });
    click(root.querySelector('#quiz-submit'));
    click(root.querySelector('#quiz-confirm-yes'));
    await tick();

    click(root.querySelector('#quiz-retry'));
    assert.equal(root.querySelector('.quiz__counter').textContent, 'Question 1 of 3');
    assert.equal(root.querySelectorAll('.quiz__dot--answered').length, 0);
});
