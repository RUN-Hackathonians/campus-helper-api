'use strict';

/**
 * Lightweight lint without extra dependencies: parses every project .js file
 * with the Node syntax checker (`node --check`). Browser-only globals are fine
 * because this never executes the files, it only parses them.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.vscode']);

function collect(dir, files) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collect(full, files);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
    return files;
}

const files = collect(ROOT, []);
let failed = 0;

for (const file of files) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log('ok   ' + path.relative(ROOT, file));
    } catch (error) {
        failed += 1;
        const message = (error.stderr || error.stdout || '').toString().trim();
        console.error('FAIL ' + path.relative(ROOT, file) + '\n' + message);
    }
}

console.log(`\n${files.length - failed}/${files.length} files passed syntax check.`);
process.exit(failed === 0 ? 0 : 1);
