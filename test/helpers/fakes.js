'use strict';

const fs = require('node:fs');

/** A 1x1 JPEG, so screenshot capture can succeed in tests without touching the real screen. */
const TINY_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/**
 * Stands in for child_process so askService's macOS `screencapture` call writes a real (tiny)
 * file instead of photographing whoever is running the tests.
 */
function fakeChildProcess({ shouldFail = false } = {}) {
    const calls = [];
    return {
        calls,
        exports: {
            execFile(command, args, callback) {
                calls.push({ command, args });
                if (shouldFail) {
                    callback(new Error('screencapture unavailable'));
                    return;
                }
                const target = args[args.length - 1];
                fs.writeFileSync(target, Buffer.from(TINY_JPEG_BASE64, 'base64'));
                callback(null, { stdout: '', stderr: '' });
            },
        },
    };
}

/** An electron stub covering only what the modules under test actually touch. */
function fakeElectron() {
    const registered = new Map();
    return {
        registered,
        exports: {
            BrowserWindow: class BrowserWindow {},
            desktopCapturer: {
                getSources: async () => [
                    {
                        thumbnail: {
                            toJPEG: () => Buffer.from(TINY_JPEG_BASE64, 'base64'),
                            getSize: () => ({ width: 1, height: 1 }),
                        },
                    },
                ],
            },
            globalShortcut: {
                register: (accelerator, callback) => {
                    registered.set(accelerator, callback);
                    return true;
                },
                unregisterAll: () => registered.clear(),
            },
            screen: {
                getAllDisplays: () => [{ id: 1 }],
            },
            ipcMain: { handle: () => {} },
        },
    };
}

/** A window whose webContents.send records everything, standing in for the Ask window. */
function fakeAskWindow() {
    const sent = [];
    return {
        sent,
        window: {
            isDestroyed: () => false,
            isVisible: () => false,
            webContents: {
                send: (channel, payload) => sent.push({ channel, payload }),
            },
        },
    };
}

module.exports = { TINY_JPEG_BASE64, fakeChildProcess, fakeElectron, fakeAskWindow };
