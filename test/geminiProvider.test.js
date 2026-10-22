'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { inlineDataFromDataUrl } = require('../src/features/common/ai/providers/gemini.js');

// captureScreenshot produces JPEG data URLs; the provider used to hardcode image/png, so Gemini
// was handed a mislabelled image and answered without really reading the screen.
test('inlineDataFromDataUrl reads the JPEG mime type off the data URL', () => {
    const { mimeType, data } = inlineDataFromDataUrl('data:image/jpeg;base64,AAAB');
    assert.equal(mimeType, 'image/jpeg');
    assert.equal(data, 'AAAB');
});

test('inlineDataFromDataUrl preserves a non-JPEG mime type', () => {
    assert.equal(inlineDataFromDataUrl('data:image/png;base64,AAAB').mimeType, 'image/png');
});

test('inlineDataFromDataUrl falls back to JPEG for a malformed URL', () => {
    assert.equal(inlineDataFromDataUrl('garbage').mimeType, 'image/jpeg');
});
