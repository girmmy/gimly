'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithStubs } = require('./helpers/loadWithStubs');

const FEATURE_BRIDGE = 'src/bridge/featureBridge.js';

/** Any property is a no-op function: enough for a module that only wires handlers. */
function nullService() {
    const target = {};
    return new Proxy(target, {
        get: (_obj, prop) => {
            if (prop === 'then') return undefined; // don't look thenable to await
            return () => {};
        },
    });
}

function loadFeatureBridge() {
    const handlers = new Map();
    const askCalls = [];

    const services = [
        '../features/settings/settingsService',
        '../features/common/services/authService',
        '../features/common/services/whisperService',
        '../features/common/services/ollamaService',
        '../features/common/services/modelStateService',
        '../features/shortcuts/shortcutsService',
        '../features/common/repositories/preset',
        '../features/common/services/localAIManager',
        '../features/listen/listenService',
        '../features/common/services/permissionService',
        '../features/common/services/encryptionService',
        '../features/common/services/promptModeService',
        '../features/common/services/userContextService',
    ];

    const stubs = {
        electron: {
            ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
            app: nullService(),
            BrowserWindow: class BrowserWindow {},
            shell: nullService(),
        },
        '../features/ask/askService': {
            sendMessage: (...args) => askCalls.push({ method: 'sendMessage', args }),
            toggleAskButton: (...args) => askCalls.push({ method: 'toggleAskButton', args }),
            closeAskWindow: (...args) => askCalls.push({ method: 'closeAskWindow', args }),
            solveScreen: (...args) => askCalls.push({ method: 'solveScreen', args }),
        },
    };
    for (const specifier of services) stubs[specifier] = nullService();

    const { module: featureBridge, restore } = loadWithStubs(FEATURE_BRIDGE, stubs);
    featureBridge.initialize();
    return { handlers, askCalls, restore };
}

test('the header Solve button has an IPC handler', async () => {
    const { handlers, askCalls, restore } = loadFeatureBridge();
    try {
        const handler = handlers.get('ask:solveScreen');
        assert.ok(handler, 'window.api.mainHeader.sendSolveScreenClick would reject without this');

        await handler({});
        assert.deepEqual(askCalls, [{ method: 'solveScreen', args: [] }]);
    } finally {
        restore();
    }
});

test('the existing ask handlers are untouched', () => {
    const { handlers, restore } = loadFeatureBridge();
    try {
        for (const channel of ['ask:toggleAskButton', 'ask:sendQuestionFromAsk', 'ask:closeAskWindow']) {
            assert.ok(handlers.get(channel), `${channel} should still be registered`);
        }
    } finally {
        restore();
    }
});
