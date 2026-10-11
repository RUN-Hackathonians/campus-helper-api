/**
 * Small, dependency-free markdown renderer for the study area.
 * Only the subset the AI summary needs is supported: headings, paragraphs, bullet
 * and numbered lists, blockquotes, rules, code and inline emphasis.
 * Nodes are built with createElement/textContent, so no markup from the backend is
 * ever executed.
 */
const CampusHelperRenderer = (() => {
    'use strict';

    const FENCE = /^\s*(```|~~~)/;
    const HEADING = /^(#{1,6})\s+(.*)$/;
    const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
    const QUOTE = /^\s*>\s?(.*)$/;
    const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const EMPHASIS = /(\*\*|__|\*|_)(?=\S)(.+?)\1/g;
    const CODE_SPAN = /`([^`]+)`/;

    const create = (tag, className) => {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        return node;
    };

    const withText = (tag, text) => {
        const node = create(tag);
        node.textContent = text;
        return node;
    };

    const appendEmphasis = (target, text) => {
        let lastIndex = 0;
        let match;

        EMPHASIS.lastIndex = 0;
        while ((match = EMPHASIS.exec(text)) !== null) {
            if (match.index > lastIndex) {
                target.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }

            target.appendChild(withText(match[1].length === 2 ? 'strong' : 'em', match[2]));
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            target.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
    };

    const appendInline = (target, text) => {
        const parts = String(text).split(CODE_SPAN);

        parts.forEach((part, index) => {
            if (index % 2 === 1) {
                target.appendChild(withText('code', part));
                return;
            }

            if (part !== '') {
                appendEmphasis(target, part);
            }
        });
    };

    const headingLevel = (hashes) => Math.min(6, Math.max(3, hashes.length + 1));

    const renderCodeBlock = (lines, start) => {
        const block = create('pre');
        const code = create('code');

        let index = start + 1;
        while (index < lines.length && !FENCE.test(lines[index])) {
            code.appendChild(document.createTextNode(lines[index] + '\n'));
            index += 1;
        }

        block.appendChild(code);
        return { node: block, next: Math.min(index + 1, lines.length) };
    };

    const renderQuote = (lines, start) => {
        const quote = create('blockquote');
        const buffer = [];

        let index = start;
        while (index < lines.length && QUOTE.test(lines[index])) {
            buffer.push(QUOTE.exec(lines[index])[1]);
            index += 1;
        }

        appendInline(quote, buffer.join(' '));
        return { node: quote, next: index };
    };

    const indentWidth = (spaces) => spaces.replace(/\t/g, '  ').length;

    const isOrderedMarker = (marker) => /^\d+[.)]$/.test(marker);

    const renderList = (lines, start) => {
        const root = create('div', 'md-list');
        const stack = [];
        let index = start;

        const top = (itemIndent, ordered) => {
            if (stack.length === 0) {
                const list = create(ordered ? 'ol' : 'ul');
                root.appendChild(list);
                stack.push({ list, indent: itemIndent });
                return stack[0];
            }

            let frame = stack[stack.length - 1];
            if (itemIndent <= frame.indent) {
                while (stack.length > 1 && itemIndent < stack[stack.length - 1].indent) {
                    stack.pop();
                }
                frame = stack[stack.length - 1];
                return frame;
            }

            const list = create(ordered ? 'ol' : 'ul');
            frame.list.lastElementChild.appendChild(list);
            const child = { list, indent: itemIndent };
            stack.push(child);
            return child;
        };

        while (index < lines.length) {
            const line = lines[index];
            const match = ITEM.exec(line);

            if (!match) {
                if (line.trim() === '') {
                    const next = index + 1;
                    if (next < lines.length && ITEM.test(lines[next])) {
                        index = next;
                        continue;
                    }
                }
                break;
            }

            const itemIndent = indentWidth(match[1]);
            const frame = top(itemIndent, isOrderedMarker(match[2]));
            const item = create('li');
            appendInline(item, match[3]);

            // Fold simple continuation lines into the current item.
            let cursor = index + 1;
            while (cursor < lines.length && lines[cursor].trim() !== '' && !ITEM.test(lines[cursor])) {
                appendInline(item, ' ' + lines[cursor].trim());
                cursor += 1;
            }

            frame.list.appendChild(item);
            index = cursor;
        }

        return { node: root, next: index };
    };

    const renderParagraph = (lines, start) => {
        const paragraph = create('p');
        const buffer = [];

        let index = start;
        while (index < lines.length) {
            const line = lines[index];
            const startsBlock = index > start && (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line));
            if (line.trim() === '' || startsBlock) {
                break;
            }
            buffer.push(line.trim());
            index += 1;
        }

        appendInline(paragraph, buffer.join(' '));
        return { node: paragraph, next: index };
    };

    const markdown = (source) => {
        const fragment = document.createDocumentFragment();
        if (typeof source !== 'string' || source.trim() === '') {
            return fragment;
        }

        const lines = source.replace(/\r\n?/g, '\n').split('\n');
        let index = 0;

        while (index < lines.length) {
            const line = lines[index];

            if (line.trim() === '') {
                index += 1;
                continue;
            }

            let block;
            if (FENCE.test(line)) {
                block = renderCodeBlock(lines, index);
            } else if (HEADING.test(line)) {
                const match = HEADING.exec(line);
                const heading = create('h' + headingLevel(match[1]));
                appendInline(heading, match[2]);
                fragment.appendChild(heading);
                index += 1;
                continue;
            } else if (RULE.test(line)) {
                fragment.appendChild(create('hr'));
                index += 1;
                continue;
            } else if (QUOTE.test(line)) {
                block = renderQuote(lines, index);
            } else if (ITEM.test(line)) {
                block = renderList(lines, index);
            } else {
                block = renderParagraph(lines, index);
            }

            if (block.node) {
                fragment.appendChild(block.node);
            }
            index = Math.max(block.next, index + 1);
        }

        return fragment;
    };

    const toPlainText = (node) => {
        const parts = [];

        const walk = (current) => {
            Array.prototype.forEach.call(current.childNodes, (child) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    parts.push(child.nodeValue);
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const tag = child.tagName.toLowerCase();
                    const isBlock = /^(p|div|h[1-6]|ul|ol|li|blockquote|pre|hr)$/.test(tag);
                    if (isBlock) {
                        parts.push('\n');
                    }
                    walk(child);
                    if (isBlock) {
                        parts.push('\n');
                    }
                }
            });
        };

        walk(node);
        return parts
            .join('')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    };

    return { markdown, toPlainText };
})();
