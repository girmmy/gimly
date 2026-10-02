'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithStubs } = require('./helpers/loadWithStubs');
const { fakeElectron } = require('./helpers/fakes');

const SHORTCUTS_SERVICE = 'src/features/shortcuts/shortcutsService.js';

function loadShortcutsService({ storedKeybinds = null } = {}) {
    const electron = fakeElectron();
    const askCalls = [];
    const saved = [];

    const stubs = {
        electron: electron.exports,
        './repositories': {
            getAllKeybinds: async () => storedKeybinds,
            upsertKeybinds: async binds => saved.push(binds),
        },
        '../../bridge/internalBridge': { emit: () => {}, on: () => {} },
        '../ask/askService': {
            toggleAskButton: (...args) => askCalls.push({ method: 'toggleAskButton', args }),
            solveScreen: (...args) => askCalls.push({ method: 'solveScreen', args }),
        },
    };

    const { module: shortcutsService, restore } = loadWithStubs(SHORTCUTS_SERVICE, stubs);
    return { shortcutsService, electron, askCalls, saved, restore };
}

/** A window pool whose header looks like a normal, fully set-up header. */
function fakeWindowPool() {
    const header = {
        isDestroyed: () => false,
        isVisible: () => true,
        currentHeaderState: 'main',
        webContents: { send: () => {} },
        setIgnoreMouseEvents: () => {},
    };
    const pool = new Map([['header', header]]);
    return pool;
}

test('solveScreen has a default keybind on both platforms', () => {
    const { shortcutsService, restore } = loadShortcutsService();
    try {
        const defaults = shortcutsService.getDefaultKeybinds();
        assert.ok(defaults.solveScreen, 'solveScreen needs a default or it is unreachable');
        assert.match(defaults.solveScreen, /^(Cmd|Ctrl)\+Shift\+Enter$/);
        assert.notEqual(
            defaults.solveScreen,
            defaults.nextStep,
            'solveScreen must not collide with the ask shortcut'
        );
    } finally {
        restore();
    }
});

test('registering shortcuts wires solveScreen to the service', async () => {
    const { shortcutsService, electron, askCalls, restore } = loadShortcutsService();
    try {
        shortcutsService.initialize(fakeWindowPool());
        await shortcutsService.registerShortcuts();

        const defaults = shortcutsService.getDefaultKeybinds();
        const callback = electron.registered.get(defaults.solveScreen);

        assert.ok(callback, `nothing registered for ${defaults.solveScreen}`);
        callback();

        assert.deepEqual(askCalls, [{ method: 'solveScreen', args: [] }]);
    } finally {
        restore();
    }
});

test('an existing install without solveScreen gets it backfilled', async () => {
    // Keybinds saved before this feature existed: everything but solveScreen.
    const legacy = [
        { action: 'nextStep', accelerator: 'Cmd+Enter' },
        { action: 'toggleVisibility', accelerator: 'Cmd+\\' },
    ];

    const { shortcutsService, saved, restore } = loadShortcutsService({ storedKeybinds: legacy });
    try {
        const keybinds = await shortcutsService.loadKeybinds();

        assert.ok(keybinds.solveScreen, 'existing installs must not be left without the shortcut');
        assert.equal(saved.length, 1, 'the backfill should be persisted once');
        assert.ok(saved[0].some(k => k.action === 'solveScreen'));
    } finally {
        restore();
    }
});

test('the ask shortcut still routes to the screen-only ask', async () => {
    const { shortcutsService, electron, askCalls, restore } = loadShortcutsService();
    try {
        shortcutsService.initialize(fakeWindowPool());
        await shortcutsService.registerShortcuts();

        const defaults = shortcutsService.getDefaultKeybinds();
        electron.registered.get(defaults.nextStep)();

        assert.deepEqual(askCalls, [{ method: 'toggleAskButton', args: [true] }]);
    } finally {
        restore();
    }
});
