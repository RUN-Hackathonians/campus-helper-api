'use strict';

/**
 * Server-only prompts. They are never returned to the client, and model
 * reasoning is never surfaced: only the validated result is sent back.
 */

const TYPE_LABELS = {
    mcq: 'multiple-choice (4 options, exactly one correct)',
    truefalse: 'true/false (answer is a boolean)',
    short: 'short-answer (a brief free-text answer)',
};

function summarize(options) {
    const mode = options && options.mode === 'pdf' ? 'PDF' : 'pasted notes';
    return {
        system: [
            'You are a study assistant that turns a student\'s own lecture material into concise, well-organized notes.',
            'Use ONLY the supplied material. Never add outside facts, definitions or examples.',
            'If the material is too short or unclear, summarize only what is present.',
            'Output clean GitHub-flavored markdown with a short overview and bullet points.',
        ].join(' '),
        user: `Summarize the following ${mode} as concise study notes.\n\n----\n${options.text}\n----`,
    };
}

function generateQuiz(options) {
    const types = options.types.map((type) => `"${type}" (${TYPE_LABELS[type]})`).join(', ');
    const scopeLine = options.scope && options.scope !== 'entire'
        ? `Focus only on this section/topic of the material: "${options.scope}".`
        : 'Cover the material as a whole.';

    const system = [
        'You write quizzes that test understanding of a student\'s OWN study material.',
        'Test only content that appears in the supplied material. Never invent facts, quotes, definitions or answers.',
        'Use the material as the single source of truth.',
        'Multiple-choice questions must have plausible distractors drawn from the material and exactly one clearly correct option.',
        'True/false answers must be a boolean. Short-answer questions must have a short, verifiable expected answer.',
        'Do not create duplicate or ambiguous questions.',
        'Keep each explanation consistent with the stated correct answer.',
        'If the material cannot support the requested number of questions, return fewer valid questions rather than inventing content.',
        'Respond with a single JSON object and nothing else. No markdown fences, no commentary.',
    ].join(' ');

    const schema = {
        title: 'short quiz title based on the material',
        questions: [
            {
                type: 'mcq | truefalse | short',
                question: 'the question text',
                options: ['only for mcq: the four options'],
                correctAnswer: 'for mcq: the exact text of the correct option',
                answerBool: 'for truefalse: true or false',
                expected: 'for short: the short expected answer',
                acceptable: ['for short: optional alternative acceptable answers'],
                explanation: 'one sentence explaining why the answer is correct',
                topic: 'the section/heading of the material this came from, if identifiable',
            },
        ],
    };

    const user = [
        `Create a ${options.difficulty} difficulty quiz with up to ${options.count} questions.`,
        `Allowed question types: ${types}. Use only these types.`,
        scopeLine,
        options.explanations
            ? 'Include an explanation for every question.'
            : 'Do not include explanations.',
        'Return JSON matching exactly this shape (arrays may contain only the fields relevant to each type):',
        JSON.stringify(schema),
        '\nStudy material:\n----\n' + options.text + '\n----',
    ].join('\n');

    return { system, user };
}

function gradeShortAnswers(items) {
    const system = [
        'You grade short-answer quiz responses against an expected answer from the student\'s own notes.',
        'Accept answers that are semantically correct even if worded differently.',
        'Do not accept answers that are vague, off-topic, or contradict the expected answer.',
        'Be strict about factual correctness and lenient about phrasing.',
        'Respond with JSON only: { "results": [ { "id": string, "correct": boolean, "confidence": number between 0 and 1, "rationale": string } ] }.',
    ].join(' ');

    const user = JSON.stringify({
        instructions: 'Grade each response. Return one result per item, matching the id.',
        items: items.map((item) => ({
            id: item.id,
            question: item.question,
            expected: item.expected,
            acceptable: item.acceptable,
            response: item.answer,
        })),
    });

    return { system, user };
}

module.exports = { summarize, generateQuiz, gradeShortAnswers };
