'use strict';

const path = require('node:path');
const Module = require('node:module');

/**
 * Loads a CommonJS module with some of its dependencies replaced.
 *
 * Gimly's main-process modules pull in electron, sqlite repositories and network clients at
 * require time, so they cannot simply be required inside a plain `node --test` process. Rather
 * than add a test framework with its own module registry (vitest wants a newer esbuild than the
 * renderer build is pinned to), this seeds `require.cache` with stub entries before loading the
 * module under test, and restores the cache afterwards.
 *
 * @param {string} modulePath Absolute path, or one relative to the repo root, of the module under test.
 * @param {Record<string, unknown>} stubs Map of specifier (as written inside the module under
 *   test, e.g. 'electron' or '../common/ai/factory') to the exports to substitute.
 * @returns {{ module: unknown, restore: () => void }}
 */
function loadWithStubs(modulePath, stubs = {}) {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const absolute = path.isAbsolute(modulePath) ? modulePath : path.join(repoRoot, modulePath);
    const baseDir = path.dirname(absolute);

    const touched = [];

    const remember = resolved => {
        touched.push({
            id: resolved,
            previous: Object.prototype.hasOwnProperty.call(require.cache, resolved)
                ? require.cache[resolved]
                : undefined,
        });
    };

    for (const [specifier, exports] of Object.entries(stubs)) {
        let resolved;
        try {
            resolved = require.resolve(specifier, { paths: [baseDir] });
        } catch {
            // A specifier that resolves to nothing on disk (an optional native dep that was never
            // installed, say) still needs a cache key. Use a stable synthetic one.
            resolved = path.join(baseDir, `__stub__${specifier.replace(/[^\w]/g, '_')}`);
        }

        remember(resolved);
        require.cache[resolved] = new Module(resolved, null);
        require.cache[resolved].filename = resolved;
        require.cache[resolved].loaded = true;
        require.cache[resolved].exports = exports;
    }

    remember(absolute);
    delete require.cache[absolute];

    const loaded = require(absolute);

    const restore = () => {
        for (const { id, previous } of touched) {
            if (previous === undefined) {
                delete require.cache[id];
            } else {
                require.cache[id] = previous;
            }
        }
        delete require.cache[absolute];
    };

    return { module: loaded, restore };
}

module.exports = { loadWithStubs };
