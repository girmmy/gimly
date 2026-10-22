'use strict';

const path = require('node:path');
const Module = require('node:module');

// Stub frames for the loads currently in flight, most recent last. A frame stays active until
// its restore() runs, so a dependency required lazily inside a method still sees the stub.
const activeStubs = [];
let originalLoad = null;

function installHook() {
    if (originalLoad) return;
    originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        for (let i = activeStubs.length - 1; i >= 0; i--) {
            if (Object.prototype.hasOwnProperty.call(activeStubs[i], request)) {
                return activeStubs[i][request];
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };
}

function uninstallHook() {
    if (originalLoad && activeStubs.length === 0) {
        Module._load = originalLoad;
        originalLoad = null;
    }
}

/**
 * Loads a CommonJS module with some of its dependencies replaced.
 *
 * Gimly's main-process modules pull in electron, sqlite repositories and network clients at
 * require time, so they cannot simply be required inside a plain `node --test` process. Rather
 * than add a test framework with its own module registry (vitest wants a newer esbuild than the
 * renderer build is pinned to), this intercepts `require` for the duration of the load and
 * hands back the stub for any specifier listed.
 *
 * Interception is by specifier rather than by resolved path so the suite runs against a bare
 * checkout: resolving 'electron' needs node_modules, which is exactly what a stubbed test is
 * meant not to need.
 *
 * @param {string} modulePath Absolute path, or one relative to the repo root, of the module under test.
 * @param {Record<string, unknown>} stubs Map of specifier (as written inside the module under
 *   test, e.g. 'electron' or '../common/ai/factory') to the exports to substitute.
 * @returns {{ module: unknown, restore: () => void }}
 */
function loadWithStubs(modulePath, stubs = {}) {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const absolute = path.isAbsolute(modulePath) ? modulePath : path.join(repoRoot, modulePath);

    const frame = { ...stubs };
    const drop = () => {
        const index = activeStubs.indexOf(frame);
        if (index !== -1) activeStubs.splice(index, 1);
        uninstallHook();
    };

    installHook();
    activeStubs.push(frame);

    let loaded;
    try {
        delete require.cache[absolute];
        loaded = require(absolute);
    } catch (error) {
        drop();
        delete require.cache[absolute];
        throw error;
    }

    const restore = () => {
        drop();
        delete require.cache[absolute];
    };

    return { module: loaded, restore };
}

module.exports = { loadWithStubs };
