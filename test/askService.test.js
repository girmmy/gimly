'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithStubs } = require('./helpers/loadWithStubs');
const { fakeChildProcess, fakeElectron, fakeAskWindow } = require('./helpers/fakes');

const ASK_SERVICE = 'src/features/ask/askService.js';

/**
 * Builds an askService whose every outbound dependency is captured rather than executed.
 * `streamChat` records the messages the model would have received and then throws, which is
 * enough to assert on the request without standing up a stream.
 */
function loadAskService({ childProcess = fakeChildProcess() } = {}) {
    const electron = fakeElectron();
    const ask = fakeAskWindow();
    const captured = { messages: null, persisted: [], visibility: [] };

    const stubs = {
        electron: electron.exports,
        child_process: childProcess.exports,
        '../../window/windowManager': {
            windowPool: { get: name => (name === 'ask' ? ask.window : null) },
        },
        '../../bridge/internalBridge': {
            emit: (event, payload) => captured.visibility.push({ event, payload }),
            on: () => {},
        },
        '../common/ai/factory': {
            createStreamingLLM: () => ({
                streamChat: async messages => {
                    captured.messages = messages;
                    throw new Error('stream halted by test');
                },
            }),
        },
        '../common/repositories/session': { getOrCreateActive: async () => 1 },
        './repositories': {
            addAiMessage: async entry => {
                captured.persisted.push(entry);
            },
        },
        '../common/services/modelStateService': {
            getCurrentModelInfo: async () => ({
                provider: 'anthropic',
                model: 'claude-test',
                apiKey: 'test-key',
            }),
        },
        '../common/services/promptModeService': { getProfile: () => 'interview_prep' },
        '../common/services/userContextService': { getContext: () => 'I am a test fixture.' },
    };

    const { module: askService, restore } = loadWithStubs(ASK_SERVICE, stubs);
    return { askService, captured, ask, electron, restore };
}

test('solveScreen sends the full instruction to the model', async () => {
    const { askService, captured, restore } = loadAskService();
    try {
        await askService.solveScreen();

        assert.ok(captured.messages, 'the model should have been called');
        const userMessage = captured.messages.find(m => m.role === 'user');
        const textPart = userMessage.content.find(part => part.type === 'text');

        assert.match(textPart.text, /solve the problem shown/i);
        assert.match(textPart.text, /if nothing on screen is solvable/i);
    } finally {
        restore();
    }
});

test('solveScreen attaches the screenshot', async () => {
    const { askService, captured, restore } = loadAskService();
    try {
        await askService.solveScreen();

        const userMessage = captured.messages.find(m => m.role === 'user');
        const image = userMessage.content.find(part => part.type === 'image_url');

        assert.ok(image, 'a screen solve without the screen is useless');
        assert.match(image.image_url.url, /^data:image\/jpeg;base64,/);
    } finally {
        restore();
    }
});

test('solveScreen shows a short label but persists the real prompt', async () => {
    const { askService, captured, ask, restore } = loadAskService();
    try {
        await askService.solveScreen();

        const stateUpdates = ask.sent.filter(m => m.channel === 'ask:stateUpdate');
        const asked = stateUpdates.find(m => m.payload.currentQuestion);
        assert.equal(asked.payload.currentQuestion, "Solve what's on screen");

        // What the model and the session history see is the full instruction, not the label.
        const userTurn = captured.persisted.find(entry => entry.role === 'user');
        assert.match(userTurn.content, /solve the problem shown/i);
    } finally {
        restore();
    }
});

test('solveScreen still asks when the screenshot fails', async () => {
    const { askService, captured, restore } = loadAskService({
        childProcess: fakeChildProcess({ shouldFail: true }),
    });
    try {
        await askService.solveScreen();

        assert.ok(captured.messages, 'a failed capture should not block the request');
        const userMessage = captured.messages.find(m => m.role === 'user');
        assert.equal(
            userMessage.content.some(part => part.type === 'image_url'),
            false,
            'no image should be attached when capture failed'
        );
    } finally {
        restore();
    }
});

test('solveScreen makes the ask window visible', async () => {
    const { askService, captured, restore } = loadAskService();
    try {
        await askService.solveScreen();

        const shown = captured.visibility.find(
            v => v.event === 'window:requestVisibility' && v.payload.name === 'ask'
        );
        assert.ok(shown, 'the ask window should be requested');
        assert.equal(shown.payload.visible, true);
    } finally {
        restore();
    }
});

test('normalizeUserPrompt keeps leading indentation on pasted code', () => {
    const { askService, restore } = loadAskService();
    try {
        const pasted = '\n\n    def solve(n):\n        return n * 2\n\n';
        assert.equal(askService.normalizeUserPrompt(pasted), '    def solve(n):\n        return n * 2');
    } finally {
        restore();
    }
});
