'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadWithStubs } = require('./helpers/loadWithStubs');

const USER_CONTEXT_SERVICE = 'src/features/common/services/userContextService.js';

/**
 * userContextService reads the real home directory, so every test points
 * GIMLY_CONTEXT_FILE at a scratch directory and reloads the module to clear its cache.
 */
function withContext(contents, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gimly-context-'));
    const previous = process.env.GIMLY_CONTEXT_FILE;

    try {
        let target = dir;
        if (typeof contents === 'string') {
            target = path.join(dir, 'context.md');
            fs.writeFileSync(target, contents);
        } else {
            for (const [name, body] of Object.entries(contents)) {
                fs.writeFileSync(path.join(dir, name), body);
            }
        }

        process.env.GIMLY_CONTEXT_FILE = target;
        const { module: service, restore } = loadWithStubs(USER_CONTEXT_SERVICE, {});
        try {
            run(service);
        } finally {
            restore();
        }
    } finally {
        if (previous === undefined) delete process.env.GIMLY_CONTEXT_FILE;
        else process.env.GIMLY_CONTEXT_FILE = previous;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('a filled context is returned to the prompt', () => {
    withContext('# My context\n\n## Experience\n\nShipped a Redis rate limiter across 38 routes.\n', service => {
        const text = service.getContext();
        assert.match(text, /Redis rate limiter across 38 routes/);
    });
});

test('an unfilled skeleton reads as empty', () => {
    // This is the whole point of _stripScaffolding: a template with nothing in it must not
    // read as context, or the model starts inventing a background to fill the headings.
    const skeleton = [
        '# My context',
        '',
        '<!-- Fill in the sections below. -->',
        '',
        '## Who I am',
        '',
        '<!-- Role, year, what you are targeting. -->',
        '',
        '## Experience',
        '',
    ].join('\n');

    withContext(skeleton, service => {
        assert.equal(service.getContext(), '');
        assert.equal(service.getStatus().found, false);
    });
});

test('hint comments are stripped before the model sees them', () => {
    withContext('## Experience\n\n<!-- a note to myself -->\nBuilt an MCP server with 14 tools.\n', service => {
        const text = service.getContext();
        assert.match(text, /14 tools/);
        assert.equal(text.includes('a note to myself'), false);
        assert.equal(text.includes('<!--'), false);
    });
});

test('a directory of files is concatenated in name order', () => {
    withContext(
        {
            'projects.md': '## Projects\n\nGoogle Tasks MCP Server.',
            'resume.md': '## Resume\n\nGeorgia Tech, CS.',
        },
        service => {
            const text = service.getContext();
            assert.ok(text.indexOf('projects.md') < text.indexOf('resume.md'), 'sorted by filename');
            assert.match(text, /Google Tasks MCP Server/);
            assert.match(text, /Georgia Tech/);
        }
    );
});

test('oversized context is truncated rather than sent whole', () => {
    withContext(`## Experience\n\n${'x'.repeat(60000)}`, service => {
        const text = service.getContext();
        assert.ok(text.length < 60000, 'context should be capped');
        assert.match(text, /\[context truncated at 48000 characters\]/);
    });
});
