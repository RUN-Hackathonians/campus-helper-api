/**
 * UI controller for campus_helper.
 * Nothing is persisted: state lives only in these variables for the current page view.
 */
(() => {
    'use strict';

    const MESSAGES = {
        empty: 'Please upload a PDF or paste your lecture notes first.',
        invalidFile: 'Please upload a valid PDF file.',
        fileTooLarge: 'That PDF is too large. Please choose a file that is smaller.',
        reading: 'Reading your lecture notes...',
        uploading: 'Uploading your lecture notes...',
        preparing: 'Preparing your summary...',
        generatingQuiz: 'Generating your questions...',
        preparingQuiz: 'Preparing your quiz...',
        limit: "You've reached the current usage limit. Please try again later.",
        generic: 'Something went wrong while processing your lecture notes. Please try again.',
        timeout: 'That took too long to process. Please try again.',
        offline: 'Could not reach the server. Please check your connection and try again.',
        noSummary: 'The summary came back empty. Please try again.',
        noQuiz: 'The quiz came back empty or unreadable. Please try again with more notes.',
        clipboardUnavailable: "Clipboard access isn't available. Please paste your text manually.",
        clipboardEmpty: 'Your clipboard looks empty. Paste your notes with Ctrl+V or Cmd+V instead.',
        copied: 'Copied!',
        copyFailed: 'Copy failed. Please select the text and copy manually.',
        hintSummary: 'Your summary will appear here. Add a PDF or paste text, then select \u201cSummarize Lecture Notes\u201d.',
        hintQuiz: 'Your quiz will appear here. Add a PDF or paste text, then select \u201cGenerate Quiz\u201d.',
    };

    const SUMMARY_STAGES = [MESSAGES.reading, MESSAGES.uploading, MESSAGES.preparing];
    const QUIZ_STAGES = [MESSAGES.reading, MESSAGES.generatingQuiz, MESSAGES.preparingQuiz];
    const PDF_EXT = /\.pdf$/i;
    const PDF_TYPES = ['application/pdf', 'application/x-pdf'];
    const PDF_SIGNATURE = '%PDF-';
    const MIN_STAGE_MS = 500;

    const el = {
        form: document.getElementById('notes-form'),
        tabs: Array.prototype.slice.call(document.querySelectorAll('[role="tab"]')),
        panels: {
            pdf: document.getElementById('panel-pdf'),
            text: document.getElementById('panel-text'),
        },
        dropzone: document.getElementById('dropzone'),
        file: document.getElementById('file-input'),
        fileInfo: document.getElementById('file-info'),
        fileName: document.getElementById('file-name'),
        fileMeta: document.getElementById('file-meta'),
        fileClear: document.getElementById('file-clear'),
        fileError: document.getElementById('file-error'),
        text: document.getElementById('paste-input'),
        textError: document.getElementById('paste-error'),
        textCount: document.getElementById('paste-count'),
        paste: document.getElementById('paste-btn'),
        pasteLabel: document.querySelector('#paste-btn .btn__label'),
        actionSummarize: document.getElementById('action-summarize'),
        actionQuiz: document.getElementById('action-quiz'),
        quizConfig: document.getElementById('quiz-config'),
        countChips: Array.prototype.slice.call(document.querySelectorAll('.chip[data-count]')),
        typeChips: Array.prototype.slice.call(document.querySelectorAll('.chip[data-type]')),
        mixedChip: document.getElementById('quiz-mixed'),
        diffChips: Array.prototype.slice.call(document.querySelectorAll('.chip[data-difficulty]')),
        countCustom: document.getElementById('quiz-count-custom'),
        scope: document.getElementById('quiz-scope'),
        explanations: document.getElementById('quiz-explanations'),
        practice: document.getElementById('quiz-practice'),
        submit: document.getElementById('submit-btn'),
        submitLabel: document.querySelector('#submit-btn .btn__label'),
        copy: document.getElementById('copy-btn'),
        copyLabel: document.querySelector('#copy-btn .btn__label'),
        status: document.getElementById('status'),
        alert: document.getElementById('alert'),
        emptyHint: document.getElementById('empty-hint'),
        resultHeading: document.getElementById('result-heading'),
        study: document.getElementById('study'),
        studyTurns: document.getElementById('study-turns'),
        quizRoot: document.getElementById('quiz-root'),
    };

    const state = {
        mode: 'pdf',
        action: 'summarize',
        file: null,
        loading: false,
        pasting: false,
        stage: 0,
        copyTimer: null,
        lastInput: null,
        lastConfig: null,
        quizController: null,
    };

    const setHidden = (node, hidden) => {
        node.hidden = hidden;
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const formatSize = (bytes) => {
        if (!Number.isFinite(bytes) || bytes < 0) {
            return '';
        }
        if (bytes < 1024) {
            return bytes + ' B';
        }
        if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(0) + ' KB';
        }
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const showFieldError = (node, control, message) => {
        node.textContent = message;
        setHidden(node, false);
        control.setAttribute('aria-invalid', 'true');
        if (!state.loading) {
            control.focus();
        }
    };

    const clearFieldError = (node, control) => {
        node.textContent = '';
        setHidden(node, true);
        control.removeAttribute('aria-invalid');
    };

    const showAlert = (message, variant) => {
        el.alert.textContent = message;
        el.alert.classList.toggle('alert--info', variant === 'info');
        setHidden(el.alert, false);
    };

    const clearAlert = () => {
        el.alert.textContent = '';
        el.alert.classList.remove('alert--info');
        setHidden(el.alert, true);
    };

    const setStatus = (text) => {
        if (!text) {
            el.status.textContent = '';
            setHidden(el.status, true);
            return;
        }

        const spinner = document.createElement('span');
        spinner.className = 'spinner';
        spinner.setAttribute('aria-hidden', 'true');
        el.status.textContent = '';
        el.status.appendChild(spinner);
        el.status.appendChild(document.createTextNode(text));
        setHidden(el.status, false);
    };

    const stagesFor = () => (state.action === 'quiz' ? QUIZ_STAGES : SUMMARY_STAGES);

    const advanceStatus = (stage) => {
        state.stage = stage;
        const stages = stagesFor();
        const label = stages[Math.min(stage, stages.length - 1)];
        setStatus(label);
        el.submitLabel.textContent = label;
    };

    const idleLabel = () => (state.action === 'quiz' ? 'Generate Quiz' : 'Summarize Lecture Notes');

    const setLoading = (isLoading) => {
        state.loading = isLoading;
        el.submit.disabled = isLoading;
        el.submit.setAttribute('aria-busy', String(isLoading));
        el.form.classList.toggle('is-busy', isLoading);
        el.form.setAttribute('aria-busy', String(isLoading));
        el.text.readOnly = isLoading;
        el.file.disabled = isLoading;
        el.fileClear.disabled = isLoading;
        el.paste.disabled = isLoading;
        el.tabs.forEach((tab) => {
            tab.disabled = isLoading;
        });
        el.actionSummarize.disabled = isLoading;
        el.actionQuiz.disabled = isLoading;

        if (isLoading) {
            state.stage = 0;
            advanceStatus(0);
        } else {
            state.stage = 0;
            setStatus('');
            el.submitLabel.textContent = idleLabel();
        }
    };

    const selectMode = (mode, moveFocus) => {
        state.mode = mode;
        el.tabs.forEach((tab) => {
            const selected = tab.id === 'tab-' + mode;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            if (selected && moveFocus) {
                tab.focus();
            }
        });

        Object.keys(el.panels).forEach((key) => {
            setHidden(el.panels[key], key !== mode);
        });
    };

    const selectTabFromKeys = (event) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) {
            return;
        }

        event.preventDefault();
        const currentIndex = el.tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
        let nextIndex = currentIndex;

        if (event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % el.tabs.length;
        } else if (event.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + el.tabs.length) % el.tabs.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = el.tabs.length - 1;
        }

        selectMode(el.tabs[nextIndex].id.replace('tab-', ''), true);
    };

    const showFileInfo = (file) => {
        el.fileName.textContent = file.name;
        el.fileMeta.textContent = formatSize(file.size);
        setHidden(el.fileInfo, false);
        el.dropzone.classList.add('is-filled');
    };

    const clearFileInfo = () => {
        el.file.value = '';
        el.fileName.textContent = '';
        el.fileMeta.textContent = '';
        setHidden(el.fileInfo, true);
        el.dropzone.classList.remove('is-filled');
    };

    const readSignature = (file) => new Promise((resolve) => {
        if (typeof FileReader === 'undefined' || typeof file.slice !== 'function') {
            resolve(null);
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve(null);
        reader.readAsBinaryString(file.slice(0, PDF_SIGNATURE.length));
    });

    const looksLikePdf = (file) => {
        if (!PDF_EXT.test(file.name || '')) {
            return false;
        }

        const type = (file.type || '').toLowerCase();
        return type === '' || PDF_TYPES.includes(type);
    };

    const selectFile = async (file) => {
        if (!file) {
            return;
        }

        clearFieldError(el.fileError, el.file);

        if (!looksLikePdf(file)) {
            clearFileInfo();
            state.file = null;
            showFieldError(el.fileError, el.file, MESSAGES.invalidFile);
            return;
        }

        const signature = await readSignature(file);
        if (signature !== null && !signature.startsWith(PDF_SIGNATURE)) {
            clearFileInfo();
            state.file = null;
            showFieldError(el.fileError, el.file, MESSAGES.invalidFile);
            return;
        }

        if (file.size > CampusHelperApi.maxFileBytes) {
            clearFileInfo();
            state.file = null;
            showFieldError(el.fileError, el.file, MESSAGES.fileTooLarge);
            return;
        }

        state.file = file;
        showFileInfo(file);
        clearFieldError(el.textError, el.text);
    };

    const updateTextCount = () => {
        const text = el.text.value;
        if (text.trim() === '') {
            el.textCount.textContent = '';
            return;
        }

        const words = text.trim().split(/\s+/).length;
        el.textCount.textContent = words === 1 ? '1 word' : words.toLocaleString() + ' words';
    };

    const insertIntoTextarea = (text) => {
        const start = el.text.selectionStart;
        const end = el.text.selectionEnd;

        el.text.setRangeText(text, start, end, 'end');
        el.text.focus();
        el.text.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const writeClipboard = async (text) => {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                return legacyCopy(text);
            }
        }

        return legacyCopy(text);
    };

    const legacyCopy = (text) => {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.setAttribute('aria-hidden', 'true');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        document.body.removeChild(helper);
        return ok;
    };

    const pasteFromClipboard = async () => {
        if (state.pasting || state.loading) {
            return;
        }

        state.pasting = true;
        el.paste.disabled = true;
        el.pasteLabel.textContent = 'Reading...';

        try {
            if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
                showAlert(MESSAGES.clipboardUnavailable, 'info');
                el.text.focus();
                return;
            }

            const text = await navigator.clipboard.readText();
            if (typeof text === 'string' && text.trim() !== '') {
                clearAlert();
                insertIntoTextarea(text);
                clearFieldError(el.textError, el.text);
            } else {
                showAlert(MESSAGES.clipboardEmpty, 'info');
            }
        } catch {
            showAlert(MESSAGES.clipboardUnavailable, 'info');
            el.text.focus();
        } finally {
            state.pasting = false;
            el.paste.disabled = state.loading;
            el.pasteLabel.textContent = 'Paste';
        }
    };

    const appendTurn = (role, content) => {
        const item = document.createElement('li');
        item.className = 'turn turn--' + (role === 'user' ? 'user' : 'assistant');

        const label = document.createElement('p');
        label.className = 'turn__role';
        label.textContent = role === 'user' ? 'You' : 'Summary';
        item.appendChild(label);

        const body = document.createElement('div');
        body.className = 'result turn__body';
        body.appendChild(CampusHelperRenderer.markdown(content));
        item.appendChild(body);

        el.studyTurns.appendChild(item);
        return item;
    };

    const renderFollowUp = (followUp) => {
        if (!followUp) {
            return;
        }

        const item = appendTurn('assistant', followUp.question);
        if (followUp.options.length === 0) {
            return;
        }

        const group = document.createElement('div');
        group.className = 'turn__options';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Reply options');

        followUp.options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn--secondary';
            button.textContent = option;
            group.appendChild(button);
        });

        item.appendChild(group);
    };

    const clearStudy = () => {
        el.studyTurns.textContent = '';
        setHidden(el.study, true);
        setHidden(el.copy, true);
        setHidden(el.emptyHint, false);
        el.copy.classList.remove('btn--success');
        el.copyLabel.textContent = 'Copy';
    };

    const clearResults = () => {
        clearStudy();
        el.quizRoot.textContent = '';
        setHidden(el.quizRoot, true);
        if (state.quizController) {
            state.quizController.destroy();
            state.quizController = null;
        }
        clearAlert();
    };

    const showStudy = (payload) => {
        clearResults();
        appendTurn('assistant', payload.summary);
        payload.turns.forEach((turn) => appendTurn(turn.role, turn.content));
        renderFollowUp(payload.followUp);
        setHidden(el.emptyHint, true);
        setHidden(el.study, false);
        if (state.action === 'summarize') {
            setHidden(el.copy, false);
        }
        el.study.scrollTop = 0;
    };

    const showQuiz = (payload, config) => {
        clearResults();
        state.lastConfig = config;
        setHidden(el.emptyHint, true);
        setHidden(el.quizRoot, false);

        state.quizController = CampusHelperQuiz.create({
            root: el.quizRoot,
            quiz: payload.quiz,
            explanations: config.explanations,
            practice: config.practice,
            grader: CampusHelperApi.gradeShortAnswers,
            onRegenerate: () => {
                if (state.lastInput) {
                    runQuiz(state.lastInput, state.lastConfig);
                }
            },
        });

        if (payload.meta && payload.meta.notices && payload.meta.notices.length) {
            showAlert(payload.meta.notices.join(' '), 'info');
        }

        el.quizRoot.scrollTop = 0;
    };

    const copyStudy = async () => {
        const text = CampusHelperRenderer.toPlainText(el.studyTurns);
        if (text === '') {
            return;
        }

        const copied = await writeClipboard(text);

        if (copied) {
            el.copyLabel.textContent = MESSAGES.copied;
            el.copy.classList.add('btn--success');
        } else {
            el.copyLabel.textContent = MESSAGES.copyFailed;
        }

        clearTimeout(state.copyTimer);
        state.copyTimer = setTimeout(() => {
            el.copyLabel.textContent = 'Copy';
            el.copy.classList.remove('btn--success');
        }, 2000);
    };

    const friendlyMessage = (error) => {
        if (!error) {
            return MESSAGES.generic;
        }

        if (error.kind === 'network') {
            return navigator.onLine === false ? MESSAGES.offline : MESSAGES.generic;
        }
        if (error.kind === 'timeout') {
            return MESSAGES.timeout;
        }
        if (error.kind === 'empty') {
            return state.action === 'quiz' ? MESSAGES.noQuiz : MESSAGES.noSummary;
        }
        if (typeof error.message === 'string' && error.message !== ''
            && !/^Request failed with status/.test(error.message)) {
            return error.message;
        }

        switch (error.kind) {
            case 'limit':
                return MESSAGES.limit;
            case 'too-large':
                return MESSAGES.fileTooLarge;
            case 'invalid':
                return MESSAGES.invalidFile;
            default:
                return MESSAGES.generic;
        }
    };

    const resolveInput = () => {
        if (state.file) {
            return { mode: 'pdf', file: state.file, text: '' };
        }

        const text = el.text.value.trim();
        if (text !== '') {
            return { mode: 'text', file: null, text };
        }

        return null;
    };

    /* ---------------------------- quiz config --------------------------- */

    const pressedChip = (selector) => document.querySelector(`${selector}[aria-pressed="true"]`);

    const selectOneChip = (chips, active) => {
        chips.forEach((chip) => {
            chip.setAttribute('aria-pressed', String(chip === active));
        });
    };

    const readQuizConfig = () => {
        const countChip = pressedChip('.chip[data-count]');
        let count = countChip ? Number(countChip.getAttribute('data-count')) : 10;
        const custom = el.countCustom.value.trim();
        if (custom !== '') {
            const parsed = Math.floor(Number(custom));
            if (Number.isFinite(parsed)) {
                count = Math.min(30, Math.max(1, parsed));
            }
        }

        const types = el.typeChips
            .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
            .map((chip) => chip.getAttribute('data-type'));
        if (types.length === 0) {
            types.push('mcq');
        }

        const diffChip = pressedChip('.chip[data-difficulty]');

        return {
            count,
            types,
            difficulty: diffChip ? diffChip.getAttribute('data-difficulty') : 'medium',
            scope: el.scope.value.trim() || 'entire',
            explanations: el.explanations.checked,
            practice: el.practice.checked,
        };
    };

    const syncMixedChip = () => {
        const all = el.typeChips.every((chip) => chip.getAttribute('aria-pressed') === 'true');
        el.mixedChip.classList.toggle('is-active', all);
    };

    const setupQuizConfig = () => {
        el.countChips.forEach((chip) => {
            chip.addEventListener('click', () => {
                selectOneChip(el.countChips, chip);
                el.countCustom.value = '';
            });
        });

        el.countCustom.addEventListener('input', () => {
            if (el.countCustom.value.trim() !== '') {
                selectOneChip(el.countChips, null);
            }
        });

        el.typeChips.forEach((chip) => {
            chip.addEventListener('click', () => {
                const isPressed = chip.getAttribute('aria-pressed') === 'true';
                if (isPressed) {
                    const stillOn = el.typeChips.filter((other) => other !== chip && other.getAttribute('aria-pressed') === 'true');
                    if (stillOn.length === 0) {
                        return; // keep at least one type selected
                    }
                    chip.setAttribute('aria-pressed', 'false');
                } else {
                    chip.setAttribute('aria-pressed', 'true');
                }
                syncMixedChip();
            });
        });

        el.mixedChip.addEventListener('click', () => {
            const activate = !el.mixedChip.classList.contains('is-active');
            el.typeChips.forEach((chip) => chip.setAttribute('aria-pressed', String(activate)));
            if (!activate) {
                // Never leave the quiz with no question type selected.
                const mcq = el.typeChips.find((chip) => chip.getAttribute('data-type') === 'mcq');
                if (mcq) {
                    mcq.setAttribute('aria-pressed', 'true');
                }
            }
            syncMixedChip();
        });

        el.diffChips.forEach((chip) => {
            chip.addEventListener('click', () => selectOneChip(el.diffChips, chip));
        });

        syncMixedChip();
    };

    const selectAction = (action) => {
        state.action = action;
        const isQuiz = action === 'quiz';

        el.actionSummarize.setAttribute('aria-checked', String(!isQuiz));
        el.actionQuiz.setAttribute('aria-checked', String(isQuiz));
        el.actionSummarize.classList.toggle('is-selected', !isQuiz);
        el.actionQuiz.classList.toggle('is-selected', isQuiz);

        setHidden(el.quizConfig, !isQuiz);
        setHidden(el.copy, true);
        el.resultHeading.textContent = isQuiz ? 'Quiz' : 'Study area';
        el.submitLabel.textContent = idleLabel();

        clearResults();
        el.emptyHint.textContent = isQuiz ? MESSAGES.hintQuiz : MESSAGES.hintSummary;
        setHidden(el.emptyHint, false);
    };

    /* ------------------------------ submit ------------------------------ */

    const runSummarize = async (input) => {
        clearResults();
        setLoading(true);

        try {
            advanceStatus(1);
            const payload = await CampusHelperApi.processNotes(input);
            advanceStatus(2);
            await sleep(MIN_STAGE_MS);
            showStudy(payload);
        } catch (error) {
            showAlert(friendlyMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const runQuiz = async (input, config) => {
        clearResults();
        state.lastInput = input;
        state.lastConfig = config;
        setLoading(true);

        try {
            advanceStatus(1);
            const payload = await CampusHelperApi.generateQuiz(Object.assign({}, input, { config }));
            advanceStatus(2);
            await sleep(MIN_STAGE_MS);
            showQuiz(payload, config);
        } catch (error) {
            showAlert(friendlyMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (state.loading) {
            return;
        }

        clearAlert();
        clearFieldError(el.fileError, el.file);
        clearFieldError(el.textError, el.text);

        const input = resolveInput();
        if (!input) {
            // Report the problem in the panel the user is actually looking at.
            if (state.mode === 'pdf') {
                showFieldError(el.fileError, el.file, MESSAGES.empty);
            } else {
                showFieldError(el.textError, el.text, MESSAGES.empty);
            }
            return;
        }

        if (state.action === 'quiz') {
            await runQuiz(input, readQuizConfig());
        } else {
            await runSummarize(input);
        }
    };

    const handleFiles = (fileList) => {
        const file = fileList && fileList.length > 0 ? fileList[0] : null;
        if (!file) {
            return;
        }

        // Keep the input in sync so "Remove" and re-picking behave normally.
        try {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            el.file.files = transfer.files;
        } catch {
            // DataTransfer is unavailable in some browsers; state.file is still used.
        }

        selectFile(file);
    };

    el.form.addEventListener('submit', handleSubmit);

    el.tabs.forEach((tab) => {
        tab.addEventListener('click', () => selectMode(tab.id.replace('tab-', ''), false));
        tab.addEventListener('keydown', selectTabFromKeys);
    });

    el.actionSummarize.addEventListener('click', () => {
        if (state.action !== 'summarize') {
            selectAction('summarize');
        }
    });
    el.actionQuiz.addEventListener('click', () => {
        if (state.action !== 'quiz') {
            selectAction('quiz');
        }
    });

    el.file.addEventListener('change', () => selectFile(el.file.files[0] || null));

    el.fileClear.addEventListener('click', () => {
        state.file = null;
        clearFileInfo();
        clearFieldError(el.fileError, el.file);
        el.file.focus();
    });

    ['dragenter', 'dragover'].forEach((type) => {
        el.dropzone.addEventListener(type, (event) => {
            event.preventDefault();
            if (!state.loading) {
                el.dropzone.classList.add('is-dragover');
            }
        });
    });

    ['dragleave', 'drop'].forEach((type) => {
        el.dropzone.addEventListener(type, (event) => {
            event.preventDefault();
            el.dropzone.classList.remove('is-dragover');
        });
    });

    el.dropzone.addEventListener('drop', (event) => {
        if (!state.loading && event.dataTransfer) {
            handleFiles(event.dataTransfer.files);
        }
    });

    el.text.addEventListener('input', () => {
        clearFieldError(el.textError, el.text);
        updateTextCount();
    });

    el.text.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            el.form.requestSubmit();
        }
    });

    el.paste.addEventListener('click', pasteFromClipboard);
    el.copy.addEventListener('click', copyStudy);

    window.addEventListener('offline', () => {
        if (!state.loading) {
            showAlert(MESSAGES.offline);
        }
    });

    selectMode('pdf', false);
    setupQuizConfig();
    updateTextCount();
    selectAction('summarize');
})();
