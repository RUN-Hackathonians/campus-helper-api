/**
 * Interactive quiz runner.
 *
 * Renders one question at a time, tracks answers, grades locally, optionally
 * refines short answers through the server grader, and shows a review screen.
 * All content is inserted with textContent/createElement: nothing from the
 * model or the server is executed as markup.
 */
const CampusHelperQuiz = (() => {
    'use strict';

    const core = window.CampusHelperQuizCore;

    const h = (tag, props, children) => {
        const node = document.createElement(tag);
        if (props) {
            Object.keys(props).forEach((key) => {
                const value = props[key];
                if (value === undefined || value === null) {
                    return;
                }
                if (key === 'class') {
                    node.className = value;
                } else if (key === 'text') {
                    node.textContent = value;
                } else if (key === 'html') {
                    // never used with untrusted content
                } else {
                    node.setAttribute(key, String(value));
                }
            });
        }
        (Array.isArray(children) ? children : (children ? [children] : [])).forEach((child) => {
            if (child) {
                node.appendChild(child);
            }
        });
        return node;
    };

    const clear = (node) => {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    };

    const TYPE_LABELS = { mcq: 'Multiple choice', truefalse: 'True or false', short: 'Short answer' };
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

    const optionText = (question, optionId) => {
        const option = (question.options || []).find((candidate) => candidate.id === optionId);
        return option ? option.text : '';
    };

    const correctAnswerText = (question) => {
        if (question.type === 'mcq') {
            return optionText(question, question.correctOptionId);
        }
        if (question.type === 'truefalse') {
            return question.correctBool ? 'True' : 'False';
        }
        return question.expected || '';
    };

    const userAnswerText = (question, response) => {
        if (!response) {
            return '';
        }
        if (question.type === 'mcq') {
            return optionText(question, response.optionId);
        }
        if (question.type === 'truefalse') {
            return typeof response.bool === 'boolean' ? (response.bool ? 'True' : 'False') : '';
        }
        return (response.text || '').trim();
    };

    function create(options) {
        const quiz = options.quiz;
        const questions = quiz.questions || [];
        const explanations = options.explanations !== false;
        const grader = typeof options.grader === 'function' ? options.grader : null;

        const state = {
            index: 0,
            responses: {},
            practice: Boolean(options.practice),
            submitted: false,
            grading: false,
            results: null,
            aiGraded: false,
            aiFailed: false,
            confirming: false,
            unmounted: false,
        };

        const root = options.root;

        const isAnswered = (question) => {
            const response = state.responses[question.id];
            if (!response) {
                return false;
            }
            if (question.type === 'mcq') {
                return Boolean(response.optionId);
            }
            if (question.type === 'truefalse') {
                return typeof response.bool === 'boolean';
            }
            return Boolean((response.text || '').trim());
        };

        const answeredCount = () => questions.filter(isAnswered).length;

        const setResponse = (id, patch) => {
            state.responses[id] = Object.assign({}, state.responses[id], patch);
        };

        /* ---------------------------------------------------------------- */

        const renderProgress = () => {
            const answered = answeredCount();
            const percent = questions.length === 0 ? 0 : Math.round((answered / questions.length) * 100);
            const fill = h('span', { class: 'progressbar__fill' });
            fill.style.width = percent + '%';
            return h('div', { class: 'quiz__progress' }, [
                h('div', {
                    class: 'progressbar',
                    role: 'progressbar',
                    'aria-valuemin': '0',
                    'aria-valuemax': String(questions.length),
                    'aria-valuenow': String(answered),
                    'aria-label': 'Questions answered',
                }, [fill]),
                h('span', { class: 'quiz__progress-text', text: `${answered} of ${questions.length} answered` }),
            ]);
        };

        const renderNavigator = () => {
            const grid = h('div', { class: 'quiz__nav-grid', role: 'list', 'aria-label': 'Question navigator' });
            questions.forEach((question, index) => {
                const status = isAnswered(question) ? 'answered' : 'unanswered';
                const classes = ['quiz__dot', `quiz__dot--${status}`];
                if (index === state.index) {
                    classes.push('is-current');
                }
                grid.appendChild(h('button', {
                    type: 'button',
                    class: classes.join(' '),
                    role: 'listitem',
                    'aria-label': `Question ${index + 1} (${status})`,
                    'aria-current': index === state.index ? 'true' : 'false',
                    text: String(index + 1),
                    'data-index': String(index),
                }));
            });
            grid.addEventListener('click', (event) => {
                const button = event.target.closest('button[data-index]');
                if (button) {
                    state.index = Number(button.getAttribute('data-index'));
                    state.confirming = false;
                    render();
                }
            });
            return grid;
        };

        const renderFeedback = (question) => {
            if (!state.practice || !isAnswered(question)) {
                return null;
            }
            const response = state.responses[question.id];
            let correct;
            if (question.type === 'mcq') {
                correct = response.optionId === question.correctOptionId;
            } else if (question.type === 'truefalse') {
                correct = response.bool === question.correctBool;
            } else {
                correct = core.gradeShortAnswer(response.text, question.expected, question.acceptable).correct;
            }

            const children = [
                h('strong', { text: correct ? 'Correct' : 'Not quite' }),
                h('span', { text: correct ? 'Good job.' : `Correct answer: ${correctAnswerText(question)}` }),
            ];
            if (explanations && question.explanation) {
                children.push(h('span', { class: 'quiz-feedback__why', text: question.explanation }));
            }
            return h('p', { class: `quiz-feedback quiz-feedback--${correct ? 'correct' : 'incorrect'}`, role: 'status' }, children);
        };

        const renderOptions = (question) => {
            if (question.type === 'short') {
                const textarea = h('textarea', {
                    class: 'field__input quiz__short',
                    rows: '4',
                    placeholder: 'Type your answer...',
                    'aria-label': 'Your answer',
                });
                textarea.value = (state.responses[question.id] || {}).text || '';
                textarea.addEventListener('input', () => {
                    setResponse(question.id, { text: textarea.value });
                    updateAnsweredState(question);
                });
                return textarea;
            }

            const choices = question.type === 'truefalse'
                ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]
                : question.options || [];

            const fieldset = h('fieldset', { class: 'quiz__options' }, [
                h('legend', { class: 'visually-hidden', text: 'Choose one answer' }),
            ]);

            const response = state.responses[question.id] || {};
            const name = 'quiz-' + question.id;

            choices.forEach((choice, index) => {
                const isBool = question.type === 'truefalse';
                const selected = isBool ? response.bool === (choice.id === 'true') : response.optionId === choice.id;
                const inputId = `${name}-${choice.id}`;

                const input = h('input', {
                    type: 'radio',
                    name: name,
                    id: inputId,
                    value: choice.id,
                });
                input.checked = selected;

                const mark = isBool ? null : h('span', { class: 'quiz-option__key', 'aria-hidden': 'true', text: LETTERS[index] || String(index + 1) });

                const label = h('label', { class: 'quiz-option', for: inputId }, [
                    input,
                    mark,
                    h('span', { class: 'quiz-option__text', text: choice.text }),
                ]);

                input.addEventListener('change', () => {
                    if (isBool) {
                        setResponse(question.id, { bool: choice.id === 'true' });
                    } else {
                        setResponse(question.id, { optionId: choice.id });
                    }
                    updateAnsweredState(question);
                    if (state.practice) {
                        render();
                    }
                });

                fieldset.appendChild(label);
            });

            return fieldset;
        };

        const updateAnsweredState = (question) => {
            const nav = root.querySelector('.quiz__nav-grid');
            if (nav) {
                const button = nav.querySelector(`button[data-index="${state.index}"]`);
                if (button) {
                    const answered = isAnswered(question);
                    button.classList.toggle('quiz__dot--answered', answered);
                    button.classList.toggle('quiz__dot--unanswered', !answered);
                }
            }
            const progress = root.querySelector('.quiz__progress');
            if (progress) {
                progress.replaceWith(renderProgress());
            }
            const status = root.querySelector('#quiz-status');
            if (status) {
                const remaining = questions.length - answeredCount();
                status.textContent = remaining === 0 ? 'All questions answered.' : `${remaining} question${remaining === 1 ? '' : 's'} unanswered.`;
            }
            const feedback = root.querySelector('#quiz-feedback-slot');
            if (feedback && state.practice) {
                const fresh = renderFeedback(question);
                clear(feedback);
                if (fresh) {
                    feedback.appendChild(fresh);
                }
            }
        };

        const renderQuestion = () => {
            const question = questions[state.index];
            const heading = h('h4', { class: 'quiz__question', id: 'quiz-question', tabindex: '-1', text: question.prompt });

            const meta = h('div', { class: 'quiz__meta' }, [
                h('span', { class: 'quiz__counter', text: `Question ${state.index + 1} of ${questions.length}` }),
                h('span', { class: 'quiz__type', text: TYPE_LABELS[question.type] || question.type }),
            ]);

            const remaining = questions.length - answeredCount();

            const nav = h('div', { class: 'quiz__nav' }, [
                h('button', {
                    type: 'button',
                    class: 'btn btn--secondary',
                    id: 'quiz-prev',
                    text: 'Previous',
                }),
                h('button', {
                    type: 'button',
                    class: 'btn btn--secondary',
                    id: 'quiz-next',
                    text: 'Next',
                }),
                h('button', {
                    type: 'button',
                    class: 'btn btn--primary',
                    id: 'quiz-submit',
                    text: 'Submit quiz',
                }),
            ]);

            const footer = state.confirming
                ? h('div', { class: 'quiz__confirm', role: 'alertdialog', 'aria-label': 'Confirm submission' }, [
                    h('p', { class: 'quiz__confirm-text', text: remaining > 0
                        ? `You still have ${remaining} unanswered question${remaining === 1 ? '' : 's'}. Submit anyway?`
                        : 'Submit your answers for grading?' }),
                    h('div', { class: 'quiz__confirm-actions' }, [
                        h('button', { type: 'button', class: 'btn btn--primary', id: 'quiz-confirm-yes', text: 'Submit now' }),
                        h('button', { type: 'button', class: 'btn btn--secondary', id: 'quiz-confirm-no', text: 'Keep working' }),
                    ]),
                ])
                : nav;

            const wrap = h('div', { class: 'quiz' }, [
                h('div', { class: 'quiz__head' }, [
                    h('h3', { class: 'quiz__title', text: quiz.title || 'Quiz' }),
                    h('p', { class: 'quiz__subtitle', text: `${questions.length} question${questions.length === 1 ? '' : 's'} · ${quiz.difficulty || 'medium'} difficulty${state.practice ? ' · practice mode' : ''}` }),
                ]),
                renderProgress(),
                renderNavigator(),
                h('div', { class: 'quiz__card' }, [
                    meta,
                    heading,
                    renderOptions(question),
                    h('div', { id: 'quiz-feedback-slot', class: 'quiz__feedback-slot' }, [renderFeedback(question)]),
                ]),
                h('p', { class: 'status', id: 'quiz-status', role: 'status', 'aria-live': 'polite', text: remaining === 0 ? 'All questions answered.' : `${remaining} question${remaining === 1 ? '' : 's'} unanswered.` }),
                footer,
            ]);

            clear(root);
            root.appendChild(wrap);

            const prev = root.querySelector('#quiz-prev');
            const next = root.querySelector('#quiz-next');
            const submit = root.querySelector('#quiz-submit');
            if (prev) {
                prev.disabled = state.index === 0;
                prev.addEventListener('click', () => {
                    state.index = Math.max(0, state.index - 1);
                    state.confirming = false;
                    render();
                });
            }
            if (next) {
                next.disabled = state.index === questions.length - 1;
                next.addEventListener('click', () => {
                    state.index = Math.min(questions.length - 1, state.index + 1);
                    state.confirming = false;
                    render();
                });
            }
            if (submit) {
                submit.addEventListener('click', () => {
                    state.confirming = true;
                    render();
                });
            }
            const yes = root.querySelector('#quiz-confirm-yes');
            if (yes) {
                yes.addEventListener('click', () => {
                    state.confirming = false;
                    grade();
                });
            }
            const no = root.querySelector('#quiz-confirm-no');
            if (no) {
                no.addEventListener('click', () => {
                    state.confirming = false;
                    render();
                });
            }

            heading.focus({ preventScroll: true });
        };

        const renderGrading = () => {
            clear(root);
            const wrap = h('div', { class: 'quiz' }, [
                h('h3', { class: 'quiz__title', text: quiz.title || 'Quiz' }),
                h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, [
                    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
                    document.createTextNode('Grading your answers...'),
                ]),
            ]);
            root.appendChild(wrap);
        };

        const buildReviewItem = (question, result) => {
            const status = result ? result.status : 'unanswered';
            const statusLabel = status === 'correct' ? 'Correct' : (status === 'incorrect' ? 'Incorrect' : 'Unanswered');

            const rows = [
                h('p', { class: 'review__prompt', text: question.prompt }),
            ];

            const yourAnswer = userAnswerText(question, state.responses[question.id]);
            rows.push(h('p', { class: 'review__line' }, [
                h('span', { class: 'review__label', text: 'Your answer:' }),
                h('span', { class: 'review__value', text: yourAnswer || 'No answer given' }),
            ]));

            if (status !== 'correct') {
                rows.push(h('p', { class: 'review__line' }, [
                    h('span', { class: 'review__label', text: 'Correct answer:' }),
                    h('span', { class: 'review__value review__value--correct', text: correctAnswerText(question) }),
                ]));
            }

            if (explanations && question.explanation) {
                rows.push(h('p', { class: 'review__line' }, [
                    h('span', { class: 'review__label', text: 'Why:' }),
                    h('span', { class: 'review__value', text: question.explanation }),
                ]));
            }

            if (question.source) {
                rows.push(h('p', { class: 'review__line' }, [
                    h('span', { class: 'review__label', text: 'Topic:' }),
                    h('span', { class: 'review__value', text: question.source }),
                ]));
            }

            if (status !== 'unanswered' && question.type === 'short') {
                const method = result && result.method === 'ai' ? 'AI-assisted' : 'automatic';
                const note = result && result.rationale ? result.rationale : 'Compared with the expected answer.';
                rows.push(h('p', { class: 'review__note', text: `${method} grading · ${note}` }));
            }

            return h('li', { class: `review__item review__item--${status}` }, [
                h('div', { class: 'review__head' }, [
                    h('span', { class: 'review__badge', text: statusLabel }),
                    h('span', { class: 'review__num', text: `Q${questions.indexOf(question) + 1}` }),
                ]),
            ].concat(rows));
        };

        const renderResults = () => {
            const results = state.results;
            const summary = h('div', { class: 'results__summary' }, [
                h('div', { class: 'results__score' }, [
                    h('span', { class: 'results__percentage', text: `${results.percentage}%` }),
                    h('span', { class: 'results__ratio', text: `${results.correct} / ${results.total} correct` }),
                ]),
                h('ul', { class: 'results__stats' }, [
                    h('li', [h('span', { class: 'results__stat-value', text: String(results.correct) }), h('span', { text: 'Correct' })]),
                    h('li', [h('span', { class: 'results__stat-value', text: String(results.incorrect) }), h('span', { text: 'Incorrect' })]),
                    h('li', [h('span', { class: 'results__stat-value', text: String(results.unanswered) }), h('span', { text: 'Unanswered' })]),
                ]),
            ]);

            const reviewList = h('ol', { class: 'review' });
            questions.forEach((question) => {
                reviewList.appendChild(buildReviewItem(question, results.byId[question.id]));
            });

            const notices = [];
            if (state.aiGraded) {
                notices.push('Short answers were graded by AI and automatic comparison. Review them with your own judgment.');
            }
            if (state.aiFailed) {
                notices.push('Some short answers were graded automatically because AI grading was unavailable.');
            }

            const actions = h('div', { class: 'results__actions' }, [
                h('button', { type: 'button', class: 'btn btn--primary', id: 'quiz-retry', text: 'Retry quiz' }),
                h('button', { type: 'button', class: 'btn btn--secondary', id: 'quiz-another', text: 'Generate another quiz' }),
            ]);

            const wrap = h('div', { class: 'quiz quiz--results' }, [
                h('div', { class: 'quiz__head' }, [
                    h('h3', { class: 'quiz__title', text: 'Results' }),
                    h('p', { class: 'quiz__subtitle', text: quiz.title || 'Quiz' }),
                ]),
                summary,
            ]
                .concat(notices.map((text) => h('p', { class: 'alert alert--info', text })))
                .concat([
                    h('h4', { class: 'review__title', text: 'Question review' }),
                    reviewList,
                    actions,
                ]));

            clear(root);
            root.appendChild(wrap);

            root.querySelector('#quiz-retry').addEventListener('click', () => {
                state.responses = {};
                state.index = 0;
                state.submitted = false;
                state.results = null;
                state.confirming = false;
                state.aiGraded = false;
                state.aiFailed = false;
                render();
            });

            root.querySelector('#quiz-another').addEventListener('click', () => {
                if (typeof options.onRegenerate === 'function') {
                    options.onRegenerate();
                }
            });
        };

        const recomputeTotals = (byId) => {
            let correct = 0;
            let incorrect = 0;
            let unanswered = 0;
            questions.forEach((question) => {
                const entry = byId[question.id] || { status: 'unanswered' };
                if (entry.status === 'correct') {
                    correct += 1;
                } else if (entry.status === 'incorrect') {
                    incorrect += 1;
                } else {
                    unanswered += 1;
                }
            });
            const total = questions.length;
            return {
                total,
                correct,
                incorrect,
                unanswered,
                percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
                byId,
            };
        };

        const grade = async () => {
            state.submitted = true;
            state.grading = true;
            renderGrading();

            const local = core.gradeQuiz(quiz, state.responses);
            const byId = {};
            local.perQuestion.forEach((entry) => {
                byId[entry.id] = { status: entry.status, correct: entry.correct, method: 'local', rationale: '' };
            });

            const shortItems = questions
                .filter((question) => question.type === 'short' && isAnswered(question))
                .map((question) => ({
                    id: question.id,
                    question: question.prompt,
                    expected: question.expected,
                    acceptable: question.acceptable || [],
                    answer: (state.responses[question.id] || {}).text || '',
                }));

            if (grader && shortItems.length > 0) {
                try {
                    const graded = await grader(shortItems);
                    const map = new Map(graded.map((entry) => [entry.id, entry]));
                    let usedAi = false;
                    shortItems.forEach((item) => {
                        const entry = map.get(item.id);
                        if (!entry) {
                            return;
                        }
                        if (entry.method === 'ai') {
                            usedAi = true;
                        }
                        byId[item.id] = {
                            status: entry.correct ? 'correct' : 'incorrect',
                            correct: entry.correct,
                            method: entry.method,
                            rationale: entry.rationale,
                        };
                    });
                    state.aiGraded = usedAi;
                } catch {
                    state.aiFailed = true;
                }
            }

            if (state.unmounted) {
                return;
            }

            state.results = recomputeTotals(byId);
            state.grading = false;
            renderResults();
        };

        const render = () => {
            if (state.submitted && state.results) {
                renderResults();
            } else {
                renderQuestion();
            }
        };

        render();

        return {
            destroy() {
                state.unmounted = true;
                clear(root);
            },
            root,
        };
    }

    return { create, TYPE_LABELS };
})();

if (typeof module === 'object' && module.exports) {
    module.exports = CampusHelperQuiz;
}
