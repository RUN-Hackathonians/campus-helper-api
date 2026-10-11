'use strict';

/**
 * A deliberately tiny DOM stand-in, just large enough to exercise the quiz
 * runner without pulling in a browser or a third-party library. It is not a
 * general-purpose DOM: it supports only what assets/js/quiz-ui.js uses.
 */

class ClassList {
    constructor(element) {
        this.element = element;
    }

    values() {
        const raw = this.element.getAttribute('class') || '';
        return raw.split(/\s+/).filter(Boolean);
    }

    write(list) {
        this.element.setAttribute('class', list.join(' '));
    }

    add(name) {
        const list = this.values();
        if (!list.includes(name)) {
            list.push(name);
            this.write(list);
        }
    }

    remove(name) {
        this.write(this.values().filter((value) => value !== name));
    }

    contains(name) {
        return this.values().includes(name);
    }

    toggle(name, force) {
        const has = this.contains(name);
        const next = force === undefined ? !has : Boolean(force);
        if (next) {
            this.add(name);
        } else {
            this.remove(name);
        }
        return next;
    }
}

class Element {
    constructor(tagName, nodeType) {
        this.tagName = (tagName || '').toUpperCase();
        this.nodeType = nodeType || 1;
        this.attributes = {};
        this.childNodes = [];
        this.parentNode = null;
        this.listeners = {};
        this.classList = new ClassList(this);
        this.style = {};
        this.value = '';
        this.checked = false;
        this.disabled = false;
    }

    get className() {
        return this.attributes.class || '';
    }

    set className(value) {
        this.attributes.class = value;
    }

    get id() {
        return this.attributes.id || '';
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }

    get textContent() {
        if (this.nodeType === 3) {
            return this._textValue || '';
        }
        return this.childNodes.map((child) => child.textContent || '').join('');
    }

    set textContent(value) {
        if (this.nodeType === 3) {
            this._textValue = value == null ? '' : String(value);
            return;
        }
        this.childNodes = [];
        if (value !== '' && value != null) {
            const text = new Element('#text', 3);
            text._textValue = String(value);
            this.appendChild(text);
        }
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    removeChild(child) {
        const index = this.childNodes.indexOf(child);
        if (index !== -1) {
            this.childNodes.splice(index, 1);
            child.parentNode = null;
        }
        return child;
    }

    replaceChild(next, current) {
        const index = this.childNodes.indexOf(current);
        if (index !== -1) {
            this.childNodes[index] = next;
            next.parentNode = this;
            current.parentNode = null;
        }
    }

    replaceWith(next) {
        if (this.parentNode) {
            this.parentNode.replaceChild(next, this);
        }
    }

    addEventListener(type, handler) {
        (this.listeners[type] = this.listeners[type] || []).push(handler);
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        let node = this;
        while (node) {
            const handlers = node.listeners[event.type] || [];
            handlers.slice().forEach((handler) => handler.call(node, event));
            if (event.__stopped) {
                break;
            }
            node = node.parentNode;
        }
        return !event.defaultPrevented;
    }

    focus() {}

    matches(selector) {
        if (selector[0] === '#') {
            return this.getAttribute('id') === selector.slice(1);
        }
        if (selector[0] === '.') {
            return this.classList.contains(selector.slice(1));
        }
        const match = /^([a-zA-Z0-9]*)(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?(?:\.([\w-]+))?$/.exec(selector);
        if (!match) {
            return false;
        }
        const [, tag, attr, attrValue, cls] = match;
        if (tag && this.tagName !== tag.toUpperCase()) {
            return false;
        }
        if (attr) {
            const actual = this.getAttribute(attr);
            if (actual === null) {
                return false;
            }
            if (attrValue !== undefined && actual !== attrValue) {
                return false;
            }
        }
        if (cls && !this.classList.contains(cls)) {
            return false;
        }
        return true;
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (node.nodeType === 1 && node.matches(selector)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const found = [];
        const walk = (node) => {
            node.childNodes.forEach((child) => {
                if (child.nodeType !== 1) {
                    return;
                }
                if (child.matches(selector)) {
                    found.push(child);
                }
                walk(child);
            });
        };
        walk(this);
        return found;
    }
}

function createTextNode(text) {
    const node = new Element('#text', 3);
    node._textValue = String(text);
    return node;
}

function createElement(tagName) {
    return new Element(tagName, 1);
}

function install() {
    const document = {
        createElement,
        createTextNode,
        body: new Element('body', 1),
    };
    global.document = document;
    return { document, Element, createElement, createTextNode };
}

module.exports = { install, Element, createElement, createTextNode };
