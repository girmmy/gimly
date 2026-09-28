const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Reads the background the user keeps about themselves — resume, projects, the role they are
 * interviewing for — from a private file outside the repository, so it is never committed and
 * stays readable only by their account.
 *
 * Lookup order (first hit wins for the single-file locations; a directory contributes all of
 * its .md/.txt files, sorted by name):
 *   1. $GIMLY_CONTEXT_FILE  — explicit override, a file or a directory
 *   2. ~/.gimly/context.md
 *   3. ~/.gimly/me.md
 *   4. ~/.gimly/context/    — one file per topic, e.g. resume.md, projects.md, target-role.md
 *
 * The prompt templates lean on this: without it they are instructed to answer behavioral
 * questions with "User context unavailable. General example only." rather than invent details.
 */

const CONTEXT_DIR = path.join(os.homedir(), '.gimly');
const CONTEXT_SUBDIR = path.join(CONTEXT_DIR, 'context');
const PRIMARY_FILE = path.join(CONTEXT_DIR, 'context.md');
const ALT_FILE = path.join(CONTEXT_DIR, 'me.md');

// Keeps the system prompt from being crowded out by a whole document dump. Roughly 12k tokens.
const MAX_CHARS = 48000;
const READABLE_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);

const TEMPLATE = `# My context

<!-- Fill in the sections below. Headings, blank lines and these HTML comments are ignored, so
     an unfilled section costs nothing. See README.md in this folder for what works well. -->

## Who I am

<!-- Role, year, what you're targeting. -->

## Experience

<!-- One entry per project or job: what you built, the stack, and a number if you have one
     (latency, users, cost, time saved). Gimly quotes these back and will not invent details
     that aren't here. -->

## Stories I want to reuse

<!-- The two or three situations you'd reach for on "tell me about a time..." questions. -->

## Interviewing for

<!-- Company, role, team, and anything from the job description worth weighting. -->
`;

const README = `# ~/.gimly

Gimly reads \`context.md\` in this folder before answering, so it can talk about your actual
experience instead of refusing to invent one. Nothing here is in the repo, and the folder is
readable only by your account (\`chmod 700\`).

## What gets read

- \`context.md\` — the main file.
- \`me.md\` — used instead if \`context.md\` doesn't exist.
- \`context/\` — a folder of \`.md\`/\`.txt\` files, all concatenated in filename order. Useful
  once you're keeping resume, projects and per-company notes apart.
- \`$GIMLY_CONTEXT_FILE\` — overrides all of the above; a file or a directory.

Headings, blank lines and HTML comments don't count as content, so a skeleton with nothing
filled in reads as empty and Gimly will say so rather than guess. Changes are picked up on the
next question — no restart. Anything past 48,000 characters is cut off.

This file (\`README.md\`) is never read as context.

## What to put in it

Specifics, because they're what Gimly can't invent: numbers, tool names, team sizes, outcomes,
what went wrong. "Cut p99 from 900ms to 120ms by batching the writes" earns an answer;
"improved performance" doesn't.
`;

class UserContextService {
    constructor() {
        this._cache = { key: null, text: '' };
    }

    /** @returns {string[]} the paths that currently contribute context, in read order */
    _resolveSources() {
        const override = process.env.GIMLY_CONTEXT_FILE;
        if (override) {
            const resolved = path.resolve(override.replace(/^~(?=$|\/)/, os.homedir()));
            return this._expand(resolved);
        }

        for (const candidate of [PRIMARY_FILE, ALT_FILE]) {
            if (this._isFile(candidate)) {
                return [candidate];
            }
        }

        return this._expand(CONTEXT_SUBDIR);
    }

    _isFile(target) {
        try {
            return fs.statSync(target).isFile();
        } catch {
            return false;
        }
    }

    _expand(target) {
        let stat;
        try {
            stat = fs.statSync(target);
        } catch {
            return [];
        }

        if (stat.isFile()) return [target];
        if (!stat.isDirectory()) return [];

        try {
            return fs
                .readdirSync(target)
                .filter(name => !name.startsWith('.') && READABLE_EXTENSIONS.has(path.extname(name).toLowerCase()))
                .sort()
                .map(name => path.join(target, name))
                .filter(file => this._isFile(file));
        } catch (error) {
            console.warn('[UserContext] Could not read context directory:', error.message);
            return [];
        }
    }

    /**
     * The user edits these files outside the app, so re-read whenever any of them changed
     * instead of caching for the lifetime of the process.
     */
    _cacheKey(sources) {
        return sources
            .map(file => {
                try {
                    const { mtimeMs, size } = fs.statSync(file);
                    return `${file}:${mtimeMs}:${size}`;
                } catch {
                    return `${file}:missing`;
                }
            })
            .join('|');
    }

    /**
     * Headings, blank lines and HTML comments are scaffolding, not content. A freshly created
     * skeleton must read as empty, otherwise the prompt treats the hint text as the user's
     * background and stops saying the context is missing.
     */
    _stripScaffolding(text) {
        return text
            .replace(/<!--[\s\S]*?-->/g, '')
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                return trimmed !== '' && !trimmed.startsWith('#');
            })
            .join('\n')
            .trim();
    }

    /**
     * @returns {string} the user's context, or '' when they haven't written one yet
     */
    getContext() {
        const sources = this._resolveSources();
        if (sources.length === 0) {
            this._cache = { key: null, text: '' };
            return '';
        }

        const key = this._cacheKey(sources);
        if (key === this._cache.key) {
            return this._cache.text;
        }

        const parts = [];
        for (const file of sources) {
            try {
                const body = fs.readFileSync(file, 'utf8').trim();
                if (!body) continue;
                parts.push(sources.length > 1 ? `### ${path.basename(file)}\n${body}` : body);
            } catch (error) {
                console.warn(`[UserContext] Could not read ${file}:`, error.message);
            }
        }

        let text = parts.join('\n\n');

        // Nothing but headings and hints means they haven't filled it in yet.
        if (!this._stripScaffolding(text)) {
            this._cache = { key, text: '' };
            return '';
        }

        // Hint comments are for the user, not the model.
        text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();

        if (text.length > MAX_CHARS) {
            text = `${text.slice(0, MAX_CHARS)}\n\n[context truncated at ${MAX_CHARS} characters]`;
            console.warn(`[UserContext] Context exceeded ${MAX_CHARS} characters and was truncated.`);
        }

        this._cache = { key, text };
        if (text) {
            console.log(`[UserContext] Loaded ${text.length} characters from ${sources.length} file(s).`);
        }
        return text;
    }

    /** Where the context lives and whether anything is there — for the settings UI. */
    getStatus() {
        const sources = this._resolveSources();
        const text = this.getContext();
        return {
            found: text.length > 0,
            chars: text.length,
            sources,
            primaryPath: process.env.GIMLY_CONTEXT_FILE || PRIMARY_FILE,
            directory: CONTEXT_DIR,
        };
    }

    /**
     * Creates ~/.gimly/context.md from a template if the user has nothing yet, with permissions
     * that keep it to their own account, and returns the path to open.
     */
    ensureContextFile() {
        const sources = this._resolveSources();
        if (sources.length > 0) {
            return { success: true, path: sources[0], created: false };
        }
        if (process.env.GIMLY_CONTEXT_FILE) {
            // The user pointed somewhere specific and it isn't there; don't invent a second home.
            return { success: false, error: `GIMLY_CONTEXT_FILE is set to ${process.env.GIMLY_CONTEXT_FILE}, which does not exist.` };
        }

        try {
            fs.mkdirSync(CONTEXT_DIR, { recursive: true, mode: 0o700 });
            fs.writeFileSync(PRIMARY_FILE, TEMPLATE, { encoding: 'utf8', mode: 0o600 });
            fs.writeFileSync(path.join(CONTEXT_DIR, 'README.md'), README, { encoding: 'utf8', mode: 0o600 });
            // mkdir ignores mode when the directory already exists, so set it explicitly.
            fs.chmodSync(CONTEXT_DIR, 0o700);
            console.log(`[UserContext] Created ${PRIMARY_FILE}`);
            return { success: true, path: PRIMARY_FILE, created: true };
        } catch (error) {
            console.error('[UserContext] Could not create context file:', error.message);
            return { success: false, error: error.message };
        }
    }
}

const userContextService = new UserContextService();

module.exports = userContextService;
module.exports.CONTEXT_DIR = CONTEXT_DIR;
module.exports.PRIMARY_FILE = PRIMARY_FILE;
