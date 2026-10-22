const js = require('@eslint/js');
const globals = require('globals');

// Flat config for the Electron app only. pickleglass_web (Next.js) and functions (Firebase)
// are separate packages that carry their own lint setup, and vendored libraries, the native
// SystemAudioDump binary and the generated renderer bundle are not ours to lint.
module.exports = [
    {
        ignores: [
            'node_modules/**',
            'pickleglass_web/**',
            'functions/**',
            'public/**',
            'docs/**',
            'aec/**',
            'src/ui/assets/**',
            'src/ui/listen/audioCore/aec.js', // generated Emscripten/wasm glue, not hand-written
        ],
    },

    js.configs.recommended,

    // Main process and tests: CommonJS running on Node/Electron.
    {
        files: ['src/**/*.js', 'test/**/*.js', '*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
    },

    // Renderer: ES modules running in the browser (Lit components, DOM, Web Audio).
    {
        files: ['src/ui/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser },
        },
    },

    {
        rules: {
            // An unused name is worth seeing but never worth failing a build over, and a leading
            // underscore is the codebase's existing "intentionally unused" marker.
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // try/catch blocks left deliberately empty are common here; the catch binding stays.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Both flag harmless style in existing, working code (a redundant rethrow; a `const`
            // in a case that already breaks/returns). Worth seeing, not worth failing the build
            // or churning stable files over. no-undef and no-redeclare stay errors — those bite.
            'no-useless-catch': 'warn',
            'no-case-declarations': 'warn',
        },
    },
];
