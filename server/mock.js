'use strict';

/**
 * Deterministic, offline "provider".
 *
 * It does not call any external service. Instead it builds extractive output
 * directly from the supplied material, so the full product flow (generate ->
 * take -> grade) can be exercised and tested without an API key. It never
 * invents facts: every question and summary sentence comes from the source.
 */

const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
    'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its',
    'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'use',
    'that', 'with', 'this', 'from', 'they', 'have', 'were', 'been', 'their', 'will',
    'into', 'than', 'then', 'some', 'such', 'when', 'which', 'them', 'then', 'also',
    'more', 'most', 'over', 'each', 'very', 'must', 'does', 'here', 'there', 'these',
    'those', 'about', 'would', 'could', 'should',
]);

function splitSentences(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 40);
}

function words(sentence) {
    return sentence
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function keyTerm(sentence) {
    const candidates = words(sentence).filter((word) => word.length >= 4 && !STOPWORDS.has(word.toLowerCase()));
    if (candidates.length === 0) {
        return null;
    }
    return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

function uniqueTerms(sentences) {
    const terms = [];
    const seen = new Set();
    sentences.forEach((sentence) => {
        const term = keyTerm(sentence);
        if (term && !seen.has(term.toLowerCase())) {
            seen.add(term.toLowerCase());
            terms.push(term);
        }
    });
    return terms;
}

function rotate(list, by) {
    if (list.length === 0) {
        return list;
    }
    const shift = ((by % list.length) + list.length) % list.length;
    return list.slice(shift).concat(list.slice(0, shift));
}

function summarize(text) {
    const sentences = splitSentences(text).slice(0, 40);
    if (sentences.length === 0) {
        const trimmed = String(text || '').trim();
        return trimmed === '' ? '' : trimmed;
    }

    const keyPoints = [];
    const seen = new Set();
    for (const sentence of sentences) {
        const key = sentence.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        keyPoints.push(sentence);
        if (keyPoints.length >= 8) {
            break;
        }
    }

    const overview = keyPoints[0];
    const rest = keyPoints.slice(1);
    const bullets = rest.map((sentence) => `- ${sentence}`).join('\n');

    return [
        '# Summary',
        '',
        overview,
        '',
        rest.length > 0 ? '## Key points' : '',
        bullets,
    ].filter((line) => line !== '').join('\n');
}

function buildMcq(sentence, term, distractors, index) {
    const blanked = sentence.replace(term, '____');
    const options = rotate([term].concat(distractors.slice(0, 3)), index);
    return {
        type: 'mcq',
        question: `Which term correctly completes this statement from your notes?\n"${blanked}"`,
        options,
        correctAnswer: term,
        explanation: `Your notes state: "${sentence}"`,
        topic: term,
    };
}

function buildTrueFalse(sentence, term, alternative, makeFalse) {
    if (!makeFalse || !alternative) {
        return {
            type: 'truefalse',
            question: `True or false: "${sentence}"`,
            answerBool: true,
            explanation: 'This statement appears verbatim in your notes.',
            topic: term,
        };
    }
    return {
        type: 'truefalse',
        question: `True or false: "${sentence.replace(term, alternative)}"`,
        answerBool: false,
        explanation: `Your notes actually state: "${sentence}"`,
        topic: term,
    };
}

function buildShort(sentence, term) {
    return {
        type: 'short',
        question: `Based on your notes, what key term does this statement define or describe?\n"${sentence.replace(term, '____')}"`,
        expected: term,
        acceptable: [],
        explanation: `The relevant term from your notes is "${term}".`,
        topic: term,
    };
}

function generateQuiz(text, config) {
    const sentences = splitSentences(text);
    const terms = uniqueTerms(sentences);
    const types = config.types && config.types.length > 0 ? config.types : ['mcq'];

    if (sentences.length === 0 || terms.length < 2) {
        return { title: 'Quiz', questions: [] };
    }

    const questions = [];
    const used = new Set();

    for (let i = 0; i < sentences.length && questions.length < config.count; i += 1) {
        const sentence = sentences[i];
        const term = keyTerm(sentence);
        if (!term || used.has(sentence)) {
            continue;
        }
        used.add(sentence);

        const others = terms.filter((candidate) => candidate.toLowerCase() !== term.toLowerCase());
        if (others.length === 0) {
            continue;
        }

        const type = types[questions.length % types.length];
        const index = questions.length;

        if (type === 'mcq') {
            questions.push(buildMcq(sentence, term, others, index));
        } else if (type === 'truefalse') {
            const makeFalse = index % 2 === 1;
            questions.push(buildTrueFalse(sentence, term, others[(index + 1) % others.length], makeFalse));
        } else {
            questions.push(buildShort(sentence, term));
        }
    }

    return { title: 'Quiz from your notes', questions };
}

/**
 * Used only when the mock provider must answer a short-answer grading request.
 * Mirrors the local token-overlap approach so offline behaviour is predictable.
 */
function gradeShortAnswers(items) {
    const normalize = (value) => String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const results = items.map((item) => {
        const response = normalize(item.answer);
        const expected = normalize(item.expected);
        const correct = response !== '' && expected !== ''
            && (response === expected || response.includes(expected) || expected.includes(response));
        return {
            id: item.id,
            correct,
            confidence: correct ? 0.8 : 0.6,
            rationale: 'Graded offline by comparing your answer with the expected answer.',
        };
    });

    return { results };
}

module.exports = { summarize, generateQuiz, gradeShortAnswers };
