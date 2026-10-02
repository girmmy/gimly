'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Pure module: no electron, no stubs needed.
const { getSystemPrompt } = require('../src/features/common/prompts/promptBuilder.js');

test('the user context lands in the prompt', () => {
    const prompt = getSystemPrompt('interview_prep', 'I shipped an MCP server with 14 tools.', false);
    assert.match(prompt, /I shipped an MCP server with 14 tools\./);
    assert.match(prompt, /User-provided context/);
});

test('both answer styles carry screen-solving instructions', () => {
    for (const profile of ['interview_prep', 'gimly_analysis']) {
        const prompt = getSystemPrompt(profile, '', false);
        assert.match(prompt, /screen/i, `${profile} should tell the model about the screen`);
    }
});

test('an unknown profile falls back rather than producing an empty prompt', () => {
    const prompt = getSystemPrompt('no-such-profile', 'context here', false);
    assert.ok(prompt.length > 0);
    assert.match(prompt, /context here/);
});

test('search instructions are opt-in', () => {
    const withSearch = getSystemPrompt('interview_prep', '', true);
    const withoutSearch = getSystemPrompt('interview_prep', '', false);
    assert.ok(withSearch.length > withoutSearch.length);
});
