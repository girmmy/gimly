import { html, css, LitElement } from '../../ui/assets/lit-core-2.7.4.min.js';
import { parser, parser_write, parser_end, default_renderer } from '../../ui/assets/smd.js';

// Strips characters that commonly sneak in with copied text (non-breaking and zero-width
// spaces, CRLF) and silently break indentation-sensitive code.
function normalizeWhitespace(text) {
    return (text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00A0/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

// Prepares code for the clipboard so it pastes cleanly into an editor: normalizes whitespace,
// removes trailing spaces and surrounding blank lines, and strips indentation shared by every
// line (models often indent code blocks nested under list items).
function normalizeCodeForClipboard(text) {
    const lines = normalizeWhitespace(text)
        .split('\n')
        .map(line => line.replace(/[ \t]+$/, ''));

    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    let commonIndent = null;
    for (const line of lines) {
        if (!line) continue;
        const indent = line.match(/^[ \t]*/)[0];
        if (commonIndent === null) {
            commonIndent = indent;
        } else {
            let i = 0;
            while (i < commonIndent.length && i < indent.length && commonIndent[i] === indent[i]) i++;
            commonIndent = commonIndent.slice(0, i);
        }
        if (!commonIndent) break;
    }

    const dedented = commonIndent ? lines.map(line => line.slice(commonIndent.length)) : lines;
    return dedented.join('\n');
}

function getCodeLanguage(codeEl) {
    const lang = [...codeEl.classList]
        .map(cls => cls.replace(/^lang(?:uage)?-/, ''))
        .find(cls => cls && cls !== 'hljs');
    return lang || 'code';
}

export class AskView extends LitElement {
    static properties = {
        currentResponse: { type: String },
        currentQuestion: { type: String },
        isLoading: { type: Boolean },
        copyState: { type: String },
        isHovering: { type: Boolean },
        hoveredLineIndex: { type: Number },
        lineCopyState: { type: Object },
        showTextInput: { type: Boolean },
        headerText: { type: String },
        headerAnimating: { type: Boolean },
        isStreaming: { type: Boolean },
    };

    static styles = css`
        :host {
            display: block;
            width: 100%;
            height: 100%;
            color: white;
            transform: translate3d(0, 0, 0);
            backface-visibility: hidden;
            transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease-out;
            will-change: transform, opacity;
        }

        :host(.hiding) {
            animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.6, 1) forwards;
        }

        :host(.showing) {
            animation: slideDown 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        :host(.hidden) {
            opacity: 0;
            transform: translateY(-150%) scale(0.85);
            pointer-events: none;
        }

        @keyframes slideUp {
            0% {
                opacity: 1;
                transform: translateY(0) scale(1);
                filter: blur(0px);
            }
            30% {
                opacity: 0.7;
                transform: translateY(-20%) scale(0.98);
                filter: blur(0.5px);
            }
            70% {
                opacity: 0.3;
                transform: translateY(-80%) scale(0.92);
                filter: blur(1.5px);
            }
            100% {
                opacity: 0;
                transform: translateY(-150%) scale(0.85);
                filter: blur(2px);
            }
        }

        @keyframes slideDown {
            0% {
                opacity: 0;
                transform: translateY(-150%) scale(0.85);
                filter: blur(2px);
            }
            30% {
                opacity: 0.5;
                transform: translateY(-50%) scale(0.92);
                filter: blur(1px);
            }
            65% {
                opacity: 0.9;
                transform: translateY(-5%) scale(0.99);
                filter: blur(0.2px);
            }
            85% {
                opacity: 0.98;
                transform: translateY(2%) scale(1.005);
                filter: blur(0px);
            }
            100% {
                opacity: 1;
                transform: translateY(0) scale(1);
                filter: blur(0px);
            }
        }

        * {
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: default;
            user-select: none;
        }

        /* Allow text selection in assistant responses */
        .response-container, .response-container * {
            user-select: text !important;
            cursor: text !important;
        }

        .response-container pre {
            background: rgba(0, 0, 0, 0.4) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            margin: 8px 0 !important;
            overflow-x: auto !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
        }

        .response-container code {
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important;
            font-size: 13px !important;
            line-height: 1.55 !important;
            background: transparent !important;
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
        }

        .response-container pre code {
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
            display: block !important;
        }

        .response-container p code {
            background: rgba(255, 255, 255, 0.1) !important;
            padding: 2px 4px !important;
            border-radius: 3px !important;
            color: #ffd700 !important;
        }

        .response-container pre,
        .response-container code {
            tab-size: 4;
        }

        .response-container .code-block {
            position: relative;
            margin: 8px 0;
        }

        .response-container .code-block pre {
            margin: 0 !important;
            padding-top: 32px !important;
        }

        .response-container .code-block-toolbar {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 6px 0 12px;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.7);
            text-transform: lowercase;
            z-index: 1;
        }

        .response-container .code-block-toolbar,
        .response-container .code-block-toolbar * {
            user-select: none !important;
            cursor: default !important;
        }

        .response-container .code-copy-button {
            display: flex;
            align-items: center;
            gap: 4px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 4px;
            color: rgba(255, 255, 255, 0.85);
            font-size: 10px;
            padding: 2px 8px;
            cursor: pointer !important;
            transition: background-color 0.15s ease;
        }

        .response-container .code-copy-button:hover {
            background: rgba(255, 255, 255, 0.18);
        }

        .response-container .code-copy-button.copied {
            background: rgba(40, 167, 69, 0.35);
            border-color: rgba(40, 167, 69, 0.6);
        }

        .hljs-keyword {
            color: #ff79c6 !important;
        }
        .hljs-string {
            color: #f1fa8c !important;
        }
        .hljs-comment {
            color: #6272a4 !important;
        }
        .hljs-number {
            color: #bd93f9 !important;
        }
        .hljs-function {
            color: #50fa7b !important;
        }
        .hljs-variable {
            color: #8be9fd !important;
        }
        .hljs-built_in {
            color: #ffb86c !important;
        }
        .hljs-title {
            color: #50fa7b !important;
        }
        .hljs-attr {
            color: #50fa7b !important;
        }
        .hljs-tag {
            color: #ff79c6 !important;
        }

        .ask-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            background: rgba(0, 0, 0, 0.9);
            border-radius: 12px;
            outline: 0.5px rgba(255, 255, 255, 0.3) solid;
            outline-offset: -1px;
            backdrop-filter: blur(1px);
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
        }

        .ask-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.15);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            filter: blur(10px);
            z-index: -1;
        }

        .response-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: transparent;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
        }

        .response-header.hidden {
            display: none;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .response-icon {
            width: 20px;
            height: 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .response-icon svg {
            width: 12px;
            height: 12px;
            stroke: rgba(255, 255, 255, 0.9);
        }

        .response-label {
            font-size: 13px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.9);
            white-space: nowrap;
            position: relative;
            overflow: hidden;
        }

        .response-label.animating {
            animation: fadeInOut 0.3s ease-in-out;
        }

        @keyframes fadeInOut {
            0% {
                opacity: 1;
                transform: translateY(0);
            }
            50% {
                opacity: 0;
                transform: translateY(-10px);
            }
            100% {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            justify-content: flex-end;
        }

        .question-text {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.7);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 300px;
            margin-right: 8px;
        }

        .header-controls {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-shrink: 0;
        }

        .copy-button {
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 4px;
            border-radius: 3px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 24px;
            flex-shrink: 0;
            transition: background-color 0.15s ease;
            position: relative;
            overflow: hidden;
        }

        .copy-button:hover {
            background: rgba(255, 255, 255, 0.15);
        }

        .copy-button svg {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
        }

        .copy-button .check-icon {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
        }

        .copy-button.copied .copy-icon {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
        }

        .copy-button.copied .check-icon {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }

        .close-button {
            background: rgba(255, 255, 255, 0.07);
            color: white;
            border: none;
            padding: 4px;
            border-radius: 20px;
            outline: 1px rgba(255, 255, 255, 0.3) solid;
            outline-offset: -1px;
            backdrop-filter: blur(0.5px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }

        .close-button:hover {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 1);
        }

        .response-container {
            flex: 1;
            padding: 16px;
            padding-left: 48px;
            overflow-y: auto;
            font-size: 15px;
            line-height: 1.65;
            background: transparent;
            min-height: 0;
            position: relative;
        }

        .response-container.hidden {
            display: none;
        }

        .response-container::-webkit-scrollbar {
            width: 6px;
        }

        .response-container::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        .loading-dots {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 40px;
        }

        .loading-dot {
            width: 8px;
            height: 8px;
            background: rgba(255, 255, 255, 0.6);
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
        }

        .loading-dot:nth-child(1) {
            animation-delay: 0s;
        }

        .loading-dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .loading-dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes pulse {
            0%,
            80%,
            100% {
                opacity: 0.3;
                transform: scale(0.8);
            }
            40% {
                opacity: 1;
                transform: scale(1.2);
            }
        }

        .response-line {
            position: relative;
            padding: 2px 0;
            margin: 0;
            transition: background-color 0.15s ease;
        }

        .response-line:hover {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
        }

        .line-copy-button {
            position: absolute;
            left: -32px;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 3px;
            padding: 2px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s ease, background-color 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }

        .response-line:hover .line-copy-button {
            opacity: 1;
        }

        .line-copy-button:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .line-copy-button.copied {
            background: rgba(40, 167, 69, 0.3);
        }

        .line-copy-button svg {
            width: 12px;
            height: 12px;
            stroke: rgba(255, 255, 255, 0.9);
        }

        .text-input-container {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            padding: 12px 16px;
            background: rgba(0, 0, 0, 0.1);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
            transition: opacity 0.1s ease-in-out, transform 0.1s ease-in-out;
            transform-origin: bottom;
        }

        .text-input-container.hidden {
            opacity: 0;
            transform: scaleY(0);
            padding: 0;
            height: 0;
            overflow: hidden;
            border-top: none;
        }

        .text-input-container.no-response {
            border-top: none;
        }

        #textInput {
            flex: 1;
            padding: 10px 14px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 16px;
            outline: none;
            border: none;
            color: white;
            font-size: 14px;
            font-family: 'Helvetica Neue', sans-serif;
            font-weight: 400;
            line-height: 20px;
            height: 40px;
            max-height: 160px;
            box-sizing: border-box;
            resize: none;
            overflow-y: auto;
            white-space: pre-wrap;
            tab-size: 4;
            user-select: text;
            cursor: text;
        }

        #textInput::placeholder {
            color: rgba(255, 255, 255, 0.5);
        }

        #textInput:focus {
            outline: none;
        }

        .response-line h1,
        .response-line h2,
        .response-line h3,
        .response-line h4,
        .response-line h5,
        .response-line h6 {
            color: rgba(255, 255, 255, 0.95);
            margin: 16px 0 8px 0;
            font-weight: 600;
        }

        .response-line p {
            margin: 8px 0;
            color: rgba(255, 255, 255, 0.96);
        }

        .response-line ul,
        .response-line ol {
            margin: 8px 0;
            padding-left: 20px;
        }

        .response-line li {
            margin: 4px 0;
            color: rgba(255, 255, 255, 0.96);
        }

        .response-line code {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.95);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 13.5px;
        }

        .response-line pre {
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.95);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 12px 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .response-line pre code {
            background: none;
            padding: 0;
        }

        .response-line blockquote {
            border-left: 3px solid rgba(255, 255, 255, 0.3);
            margin: 12px 0;
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.8);
        }

        .empty-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: rgba(255, 255, 255, 0.5);
            font-size: 14px;
        }

        .btn-gap {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 4px;
        }

        /* ────────────────[ GLASS BYPASS ]─────────────── */
        :host-context(body.has-glass) .ask-container,
        :host-context(body.has-glass) .response-header,
        :host-context(body.has-glass) .response-icon,
        :host-context(body.has-glass) .copy-button,
        :host-context(body.has-glass) .close-button,
        :host-context(body.has-glass) .line-copy-button,
        :host-context(body.has-glass) .text-input-container,
        :host-context(body.has-glass) .response-container pre,
        :host-context(body.has-glass) .response-container p code,
        :host-context(body.has-glass) .response-container pre code {
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            filter: none !important;
            backdrop-filter: none !important;
        }

        :host-context(body.has-glass) .ask-container::before {
            display: none !important;
        }

        :host-context(body.has-glass) .copy-button:hover,
        :host-context(body.has-glass) .close-button:hover,
        :host-context(body.has-glass) .line-copy-button,
        :host-context(body.has-glass) .line-copy-button:hover,
        :host-context(body.has-glass) .response-line:hover {
            background: transparent !important;
        }

        :host-context(body.has-glass) .response-container::-webkit-scrollbar-track,
        :host-context(body.has-glass) .response-container::-webkit-scrollbar-thumb {
            background: transparent !important;
        }

        .submit-btn, .clear-btn {
            display: flex;
            align-items: center;
            background: transparent;
            color: white;
            border: none;
            border-radius: 6px;
            margin-left: 8px;
            font-size: 13px;
            font-family: 'Helvetica Neue', sans-serif;
            font-weight: 500;
            overflow: hidden;
            cursor: pointer;
            transition: background 0.15s;
            height: 32px;
            padding: 0 10px;
            box-shadow: none;
        }
        .submit-btn:hover, .clear-btn:hover {
            background: rgba(255,255,255,0.1);
        }
        .btn-label {
            margin-right: 8px;
            display: flex;
            align-items: center;
            height: 100%;
        }
        .btn-icon {
            background: rgba(255,255,255,0.1);
            border-radius: 13%;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
        }
        .btn-icon img, .btn-icon svg {
            width: 13px;
            height: 13px;
            display: block;
        }
        .header-clear-btn {
            background: transparent;
            border: none;
            display: flex;
            align-items: center;
            gap: 2px;
            cursor: pointer;
            padding: 0 2px;
        }
        .header-clear-btn .icon-box {
            color: white;
            font-size: 12px;
            font-family: 'Helvetica Neue', sans-serif;
            font-weight: 500;
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 13%;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .header-clear-btn:hover .icon-box {
            background-color: rgba(255,255,255,0.18);
        }
    `;

    constructor() {
        super();
        this.currentResponse = '';
        this.currentQuestion = '';
        this.isLoading = false;
        this.copyState = 'idle';
        this.showTextInput = true;
        this.headerText = 'AI Response';
        this.headerAnimating = false;
        this.isStreaming = false;

        this.marked = null;
        this.hljs = null;
        this.DOMPurify = null;
        this.isLibrariesLoaded = false;

        // SMD.js streaming markdown parser
        this.smdParser = null;
        this.smdContainer = null;
        this.lastProcessedLength = 0;

        this.handleSendText = this.handleSendText.bind(this);
        this.handleTextKeydown = this.handleTextKeydown.bind(this);
        this.handleCopy = this.handleCopy.bind(this);
        this.clearResponseContent = this.clearResponseContent.bind(this);
        this.handleEscKey = this.handleEscKey.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleCloseAskWindow = this.handleCloseAskWindow.bind(this);
        this.handleCloseIfNoContent = this.handleCloseIfNoContent.bind(this);
        this.handleTextInput = this.handleTextInput.bind(this);
        this.handleTextPaste = this.handleTextPaste.bind(this);
        this.handleResponseCopy = this.handleResponseCopy.bind(this);

        this.lineCopyState = {};
        this.lineCopyTimeouts = {};
        this.smdEnded = false;

        this.loadLibraries();

        // --- Resize helpers ---
        this.isThrottled = false;
    }

    connectedCallback() {
        super.connectedCallback();

        console.log('📱 AskView connectedCallback - IPC 이벤트 리스너 설정');

        document.addEventListener('keydown', this.handleEscKey);

        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const needed = entry.contentRect.height;
                const current = window.innerHeight;

                if (needed > current - 4) {
                    this.requestWindowResize(Math.ceil(needed));
                }
            }
        });

        const container = this.shadowRoot?.querySelector('.ask-container');
        if (container) this.resizeObserver.observe(container);

        this.handleQuestionFromAssistant = (event, question) => {
            console.log('AskView: Received question from ListenView:', question);
            this.handleSendText(null, question);
        };

        if (window.api) {
            window.api.askView.onShowTextInput(() => {
                console.log('Show text input signal received');
                if (!this.showTextInput) {
                    this.showTextInput = true;
                    this.updateComplete.then(() => this.focusTextInput());
                  } else {
                    this.focusTextInput();
                  }
            });

            window.api.askView.onScrollResponseUp(() => this.handleScroll('up'));
            window.api.askView.onScrollResponseDown(() => this.handleScroll('down'));
            window.api.askView.onAskStateUpdate((event, newState) => {
                this.currentResponse = newState.currentResponse;
                this.currentQuestion = newState.currentQuestion;
                this.isLoading       = newState.isLoading;
                this.isStreaming     = newState.isStreaming;
              
                const wasHidden = !this.showTextInput;
                this.showTextInput = newState.showTextInput;
              
                if (newState.showTextInput) {
                  if (wasHidden) {
                    this.updateComplete.then(() => this.focusTextInput());
                  } else {
                    this.focusTextInput();
                  }
                }
              });
            console.log('AskView: IPC 이벤트 리스너 등록 완료');
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.resizeObserver?.disconnect();

        console.log('📱 AskView disconnectedCallback - IPC 이벤트 리스너 제거');

        document.removeEventListener('keydown', this.handleEscKey);

        if (this.copyTimeout) {
            clearTimeout(this.copyTimeout);
        }

        if (this.headerAnimationTimeout) {
            clearTimeout(this.headerAnimationTimeout);
        }

        if (this.streamingTimeout) {
            clearTimeout(this.streamingTimeout);
        }

        Object.values(this.lineCopyTimeouts).forEach(timeout => clearTimeout(timeout));

        if (window.api) {
            window.api.askView.removeOnAskStateUpdate(this.handleAskStateUpdate);
            window.api.askView.removeOnShowTextInput(this.handleShowTextInput);
            window.api.askView.removeOnScrollResponseUp(this.handleScroll);
            window.api.askView.removeOnScrollResponseDown(this.handleScroll);
            console.log('✅ AskView: IPC 이벤트 리스너 제거 필요');
        }
    }


    async loadLibraries() {
        try {
            if (!window.marked) {
                await this.loadScript('../../assets/marked-4.3.0.min.js');
            }

            if (!window.hljs) {
                await this.loadScript('../../assets/highlight-11.9.0.min.js');
            }

            if (!window.DOMPurify) {
                await this.loadScript('../../assets/dompurify-3.0.7.min.js');
            }

            this.marked = window.marked;
            this.hljs = window.hljs;
            this.DOMPurify = window.DOMPurify;

            if (this.marked && this.hljs) {
                this.marked.setOptions({
                    highlight: (code, lang) => {
                        if (lang && this.hljs.getLanguage(lang)) {
                            try {
                                return this.hljs.highlight(code, { language: lang }).value;
                            } catch (err) {
                                console.warn('Highlight error:', err);
                            }
                        }
                        try {
                            return this.hljs.highlightAuto(code).value;
                        } catch (err) {
                            console.warn('Auto highlight error:', err);
                        }
                        return code;
                    },
                    breaks: true,
                    gfm: true,
                    pedantic: false,
                    smartypants: false,
                    xhtml: false,
                });

                this.isLibrariesLoaded = true;
                this.renderContent();
                console.log('Markdown libraries loaded successfully in AskView');
            }

            if (this.DOMPurify) {
                this.isDOMPurifyLoaded = true;
                console.log('DOMPurify loaded successfully in AskView');
            }
        } catch (error) {
            console.error('Failed to load libraries in AskView:', error);
        }
    }

    handleCloseAskWindow() {
        // this.clearResponseContent();
        window.api.askView.closeAskWindow();
    }

    handleCloseIfNoContent() {
        if (!this.currentResponse && !this.isLoading && !this.isStreaming) {
            this.handleCloseAskWindow();
        }
    }

    handleEscKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.handleCloseIfNoContent();
            return;
        }

        // Cmd/Ctrl+Shift+C copies just the code from the current answer
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            this.handleCopyAllCode();
        }
    }

    clearResponseContent() {
        this.currentResponse = '';
        this.currentQuestion = '';
        this.isLoading = false;
        this.isStreaming = false;
        this.headerText = 'AI Response';
        this.showTextInput = true;
        this.lastProcessedLength = 0;
        this.smdParser = null;
        this.smdContainer = null;
    }

    handleInputFocus() {
        this.isInputFocused = true;
    }

    focusTextInput() {
        requestAnimationFrame(() => {
            const textInput = this.shadowRoot?.getElementById('textInput');
            if (textInput) {
                textInput.focus();
            }
        });
    }


    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    parseMarkdown(text) {
        if (!text) return '';

        if (!this.isLibrariesLoaded || !this.marked) {
            return text;
        }

        try {
            return this.marked(text);
        } catch (error) {
            console.error('Markdown parsing error in AskView:', error);
            return text;
        }
    }

    fixIncompleteCodeBlocks(text) {
        if (!text) return text;

        const codeBlockMarkers = text.match(/```/g) || [];
        const markerCount = codeBlockMarkers.length;

        if (markerCount % 2 === 1) {
            return text + '\n```';
        }

        return text;
    }

    handleScroll(direction) {
        const scrollableElement = this.shadowRoot.querySelector('#responseContainer');
        if (scrollableElement) {
            const scrollAmount = 100; // 한 번에 스크롤할 양 (px)
            if (direction === 'up') {
                scrollableElement.scrollTop -= scrollAmount;
            } else {
                scrollableElement.scrollTop += scrollAmount;
            }
        }
    }


    renderContent() {
        const responseContainer = this.shadowRoot.getElementById('responseContainer');
        if (!responseContainer) return;
    
        // Check loading state
        if (this.isLoading) {
            responseContainer.innerHTML = `
              <div class="loading-dots">
                <div class="loading-dot"></div>
                <div class="loading-dot"></div>
                <div class="loading-dot"></div>
              </div>`;
            this.resetStreamingParser();
            return;
        }
        
        // If there is no response, show empty state
        if (!this.currentResponse) {
            responseContainer.innerHTML = `<div class="empty-state">...</div>`;
            this.resetStreamingParser();
            return;
        }
        
        // Set streaming markdown parser
        this.renderStreamingMarkdown(responseContainer);

        // After updating content, recalculate window height
        this.adjustWindowHeightThrottled();
    }

    resetStreamingParser() {
        this.smdParser = null;
        this.smdContainer = null;
        this.lastProcessedLength = 0;
        this.smdEnded = false;
    }

    renderStreamingMarkdown(responseContainer) {
        try {
            // 파서가 없거나 컨테이너가 변경되었으면 새로 생성
            if (!this.smdParser || this.smdContainer !== responseContainer) {
                this.smdContainer = responseContainer;
                this.smdContainer.innerHTML = '';
                
                // smd.js의 default_renderer 사용
                const renderer = default_renderer(this.smdContainer);
                this.smdParser = parser(renderer);
                this.lastProcessedLength = 0;
                this.smdEnded = false;
            }

            // 새로운 텍스트만 처리 (스트리밍 최적화)
            const currentText = this.currentResponse;
            const newText = currentText.slice(this.lastProcessedLength);
            
            if (newText.length > 0) {
                // 새로운 텍스트 청크를 파서에 전달
                parser_write(this.smdParser, newText);
                this.lastProcessedLength = currentText.length;
            }

            const isComplete = !this.isStreaming && !this.isLoading;

            // 스트리밍이 완료되면 파서 종료 (flushes characters the parser is still holding back)
            if (isComplete && !this.smdEnded) {
                parser_end(this.smdParser);
                this.smdEnded = true;
            }

            this.decorateCodeBlocks(responseContainer);

            // 코드 하이라이팅 적용 — only once the answer is complete, since highlighting a
            // half-streamed block leaves the rest of it unhighlighted
            if (this.hljs && isComplete) {
                responseContainer.querySelectorAll('pre code').forEach(block => {
                    if (!block.hasAttribute('data-highlighted')) {
                        this.hljs.highlightElement(block);
                        block.setAttribute('data-highlighted', 'true');
                    }
                });
            }

            // 스크롤을 맨 아래로
            responseContainer.scrollTop = responseContainer.scrollHeight;
            
        } catch (error) {
            console.error('Error rendering streaming markdown:', error);
            // 에러 발생 시 기본 텍스트 렌더링으로 폴백
            this.renderFallbackContent(responseContainer);
        }
    }

    renderFallbackContent(responseContainer) {
        const textToRender = this.currentResponse || '';
        
        if (this.isLibrariesLoaded && this.marked && this.DOMPurify) {
            try {
                // 마크다운 파싱
                const parsedHtml = this.marked.parse(textToRender);

                // DOMPurify로 정제
                const cleanHtml = this.DOMPurify.sanitize(parsedHtml, {
                    ALLOWED_TAGS: [
                        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'b', 'em', 'i',
                        'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'table', 'thead',
                        'tbody', 'tr', 'th', 'td', 'hr', 'sup', 'sub', 'del', 'ins',
                    ],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
                });

                responseContainer.innerHTML = cleanHtml;

                // 코드 하이라이팅 적용
                if (this.hljs) {
                    responseContainer.querySelectorAll('pre code').forEach(block => {
                        this.hljs.highlightElement(block);
                    });
                }
                this.decorateCodeBlocks(responseContainer);
            } catch (error) {
                console.error('Error in fallback rendering:', error);
                responseContainer.textContent = textToRender;
            }
        } else {
            // 라이브러리가 로드되지 않았을 때 기본 렌더링
            const basicHtml = textToRender
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n\n/g, '</p><p>')
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');

            responseContainer.innerHTML = `<p>${basicHtml}</p>`;
        }
    }


    // Wraps each <pre> in a container with a language label and a Copy button. Safe to call
    // repeatedly while streaming: smd keeps writing into the <code> element, not the <pre>.
    decorateCodeBlocks(container) {
        container.querySelectorAll('pre').forEach(pre => {
            const code = pre.querySelector('code');
            if (!code) return;

            const existing = pre.parentElement?.classList.contains('code-block') ? pre.parentElement : null;
            if (existing) {
                existing.querySelector('.code-lang').textContent = getCodeLanguage(code);
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'code-block';
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            const toolbar = document.createElement('div');
            toolbar.className = 'code-block-toolbar';

            const label = document.createElement('span');
            label.className = 'code-lang';
            label.textContent = getCodeLanguage(code);

            const button = document.createElement('button');
            button.className = 'code-copy-button';
            button.textContent = 'Copy';
            button.title = 'Copy code';
            button.addEventListener('click', e => {
                e.stopPropagation();
                this.copyCodeBlock(code, button);
            });

            toolbar.append(label, button);
            wrapper.insertBefore(toolbar, pre);
        });
    }

    async copyCodeBlock(codeEl, button) {
        const copied = await this.writeToClipboard(normalizeCodeForClipboard(codeEl.textContent));
        if (!copied) return;

        button.textContent = 'Copied';
        button.classList.add('copied');
        clearTimeout(button._resetTimeout);
        button._resetTimeout = setTimeout(() => {
            button.textContent = 'Copy';
            button.classList.remove('copied');
        }, 1500);
    }

    async writeToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // navigator.clipboard can reject when the window isn't focused; fall back to execCommand
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            if (!ok) console.error('Failed to copy:', err);
            return ok;
        }
    }

    // When a selection lies inside a single code block, copy it as clean plain text instead of
    // styled HTML, so it pastes into editors with its indentation intact.
    handleResponseCopy(e) {
        const selection = this.shadowRoot.getSelection ? this.shadowRoot.getSelection() : window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const preOf = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('pre');
        const pre = preOf(selection.anchorNode);
        if (!pre || pre !== preOf(selection.focusNode)) return;

        e.preventDefault();
        e.clipboardData.setData('text/plain', normalizeCodeForClipboard(selection.toString()));
    }

    requestWindowResize(targetHeight) {
        if (window.api) {
            window.api.askView.adjustWindowHeight('ask', targetHeight);
        }
    }

    animateHeaderText(text) {
        this.headerAnimating = true;
        this.requestUpdate();

        setTimeout(() => {
            this.headerText = text;
            this.headerAnimating = false;
            this.requestUpdate();
        }, 150);
    }

    startHeaderAnimation() {
        this.animateHeaderText('analyzing screen...');

        if (this.headerAnimationTimeout) {
            clearTimeout(this.headerAnimationTimeout);
        }

        this.headerAnimationTimeout = setTimeout(() => {
            this.animateHeaderText('thinking...');
        }, 1500);
    }

    renderMarkdown(content) {
        if (!content) return '';

        if (this.isLibrariesLoaded && this.marked) {
            return this.parseMarkdown(content);
        }

        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    fixIncompleteMarkdown(text) {
        if (!text) return text;

        // 불완전한 볼드체 처리
        const boldCount = (text.match(/\*\*/g) || []).length;
        if (boldCount % 2 === 1) {
            text += '**';
        }

        // 불완전한 이탤릭체 처리
        const italicCount = (text.match(/(?<!\*)\*(?!\*)/g) || []).length;
        if (italicCount % 2 === 1) {
            text += '*';
        }

        // 불완전한 인라인 코드 처리
        const inlineCodeCount = (text.match(/`/g) || []).length;
        if (inlineCodeCount % 2 === 1) {
            text += '`';
        }

        // 불완전한 링크 처리
        const openBrackets = (text.match(/\[/g) || []).length;
        const closeBrackets = (text.match(/\]/g) || []).length;
        if (openBrackets > closeBrackets) {
            text += ']';
        }

        const openParens = (text.match(/\]\(/g) || []).length;
        const closeParens = (text.match(/\)\s*$/g) || []).length;
        if (openParens > closeParens && text.endsWith('(')) {
            text += ')';
        }

        return text;
    }


    async handleCopy() {
        if (this.copyState === 'copied') return;

        // Copy only the answer (as markdown) — the "Question:/Answer:" wrapper got in the way
        // when pasting into notes or editors.
        await this.copyTextWithFeedback(normalizeWhitespace(this.currentResponse).trim());
    }

    // Copies every code block in the answer, separated by blank lines (Cmd/Ctrl+Shift+C).
    async handleCopyAllCode() {
        const codeBlocks = [...(this.shadowRoot?.querySelectorAll('#responseContainer pre code') || [])];
        if (codeBlocks.length === 0) return;

        const text = codeBlocks.map(code => normalizeCodeForClipboard(code.textContent)).join('\n\n');
        await this.copyTextWithFeedback(text);
    }

    async copyTextWithFeedback(textToCopy) {
        if (this.copyState === 'copied' || !textToCopy) return;

        try {
            if (!(await this.writeToClipboard(textToCopy))) return;
            console.log('Content copied to clipboard');

            this.copyState = 'copied';
            this.requestUpdate();

            if (this.copyTimeout) {
                clearTimeout(this.copyTimeout);
            }

            this.copyTimeout = setTimeout(() => {
                this.copyState = 'idle';
                this.requestUpdate();
            }, 1500);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }

    async handleLineCopy(lineIndex) {
        const originalLines = this.currentResponse.split('\n');
        const lineToCopy = originalLines[lineIndex];

        if (!lineToCopy) return;

        try {
            await navigator.clipboard.writeText(lineToCopy);
            console.log('Line copied to clipboard');

            // '복사됨' 상태로 UI 즉시 업데이트
            this.lineCopyState = { ...this.lineCopyState, [lineIndex]: true };
            this.requestUpdate(); // LitElement에 UI 업데이트 요청

            // 기존 타임아웃이 있다면 초기화
            if (this.lineCopyTimeouts && this.lineCopyTimeouts[lineIndex]) {
                clearTimeout(this.lineCopyTimeouts[lineIndex]);
            }

            // ✨ 수정된 타임아웃: 1.5초 후 '복사됨' 상태 해제
            this.lineCopyTimeouts[lineIndex] = setTimeout(() => {
                const updatedState = { ...this.lineCopyState };
                delete updatedState[lineIndex];
                this.lineCopyState = updatedState;
                this.requestUpdate(); // UI 업데이트 요청
            }, 1500);
        } catch (err) {
            console.error('Failed to copy line:', err);
        }
    }

    async handleSendText(e, overridingText = '') {
        const textInput = this.shadowRoot?.getElementById('textInput');
        const rawText = overridingText || textInput?.value || '';
        // Keep the text as typed/pasted (indentation matters for code); the service normalizes it
        const text = rawText.trim() ? rawText : '';
        // if (!text) return;

        if (textInput) {
            textInput.value = '';
            this.autoResizeTextInput();
        }

        if (window.api) {
            window.api.askView.sendMessage(text).catch(error => {
                console.error('Error sending text:', error);
            });
        }
    }

    handleTextKeydown(e) {
        // Fix for IME composition issue: Ignore Enter key presses while composing.
        if (e.isComposing) {
            return;
        }

        // Tab indents inside the input instead of moving focus away
        if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            this.insertTextAtCursor(e.target, '    ');
            return;
        }

        // Enter sends; Shift+Enter falls through and inserts a newline
        const isPlainEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey;
        const isModifierEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey);

        if (isPlainEnter || isModifierEnter) {
            e.preventDefault();
            this.handleSendText();
        }
    }

    handleTextInput() {
        this.autoResizeTextInput();
    }

    // Pasted code often carries CRLF line endings or non-breaking/zero-width spaces
    // (from browsers, Slack, docs); clean them up before they reach the input.
    handleTextPaste(e) {
        const pasted = e.clipboardData?.getData('text/plain');
        if (!pasted) return;

        const cleaned = normalizeWhitespace(pasted);
        if (cleaned === pasted) return;

        e.preventDefault();
        this.insertTextAtCursor(e.target, cleaned);
    }

    insertTextAtCursor(textarea, text) {
        // execCommand keeps native undo (Cmd+Z) working; setRangeText is the fallback
        if (!document.execCommand('insertText', false, text)) {
            textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
        }
        this.autoResizeTextInput();
    }

    autoResizeTextInput() {
        const textInput = this.shadowRoot?.getElementById('textInput');
        if (!textInput) return;

        textInput.style.height = 'auto';
        textInput.style.height = `${Math.min(textInput.scrollHeight, 160)}px`;
        this.adjustWindowHeightThrottled();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
    
        // ✨ isLoading 또는 currentResponse가 변경될 때마다 뷰를 다시 그립니다.
        // isStreaming matters too: the final state update flips it off without changing the
        // response text, and that's when the parser gets flushed and code gets highlighted.
        if (changedProperties.has('isLoading') || changedProperties.has('currentResponse') || changedProperties.has('isStreaming')) {
            this.renderContent();
        }
    
        if (changedProperties.has('showTextInput') || changedProperties.has('isLoading') || changedProperties.has('currentResponse')) {
            this.adjustWindowHeightThrottled();
        }
    
        if (changedProperties.has('showTextInput') && this.showTextInput) {
            this.focusTextInput();
        }
    }

    firstUpdated() {
        setTimeout(() => this.adjustWindowHeight(), 200);
    }


    getTruncatedQuestion(question, maxLength = 30) {
        if (!question) return '';
        if (question.length <= maxLength) return question;
        return question.substring(0, maxLength) + '...';
    }



    render() {
        const hasResponse = this.isLoading || this.currentResponse || this.isStreaming;
        const headerText = this.isLoading ? 'Thinking...' : 'AI Response';

        return html`
            <div class="ask-container">
                <!-- Response Header -->
                <div class="response-header ${!hasResponse ? 'hidden' : ''}">
                    <div class="header-left">
                        <div class="response-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                                <path d="M8 12l2 2 4-4" />
                            </svg>
                        </div>
                        <span class="response-label">${headerText}</span>
                    </div>
                    <div class="header-right">
                        <span class="question-text">${this.getTruncatedQuestion(this.currentQuestion)}</span>
                        <div class="header-controls">
                            <button class="copy-button ${this.copyState === 'copied' ? 'copied' : ''}" @click=${this.handleCopy}>
                                <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                </svg>
                                <svg
                                    class="check-icon"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.5"
                                >
                                    <path d="M20 6L9 17l-5-5" />
                                </svg>
                            </button>
                            <button class="close-button" @click=${this.handleCloseAskWindow}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Response Container -->
                <div class="response-container ${!hasResponse ? 'hidden' : ''}" id="responseContainer" @copy=${this.handleResponseCopy}>
                    <!-- Content is dynamically generated in updateResponseContent() -->
                </div>

                <!-- Text Input Container -->
                <div class="text-input-container ${!hasResponse ? 'no-response' : ''} ${!this.showTextInput ? 'hidden' : ''}">
                    <textarea
                        id="textInput"
                        rows="1"
                        spellcheck="false"
                        placeholder="Ask about your screen or audio"
                        @keydown=${this.handleTextKeydown}
                        @input=${this.handleTextInput}
                        @paste=${this.handleTextPaste}
                        @focus=${this.handleInputFocus}
                    ></textarea>
                    <button
                        class="submit-btn"
                        @click=${this.handleSendText}
                    >
                        <span class="btn-label">Submit</span>
                        <span class="btn-icon">
                            ↵
                        </span>
                    </button>
                </div>
            </div>
        `;
    }

    // Dynamically resize the BrowserWindow to fit current content
    adjustWindowHeight() {
        if (!window.api) return;

        this.updateComplete.then(() => {
            const headerEl = this.shadowRoot.querySelector('.response-header');
            const responseEl = this.shadowRoot.querySelector('.response-container');
            const inputEl = this.shadowRoot.querySelector('.text-input-container');

            if (!headerEl || !responseEl) return;

            const headerHeight = headerEl.classList.contains('hidden') ? 0 : headerEl.offsetHeight;
            const responseHeight = responseEl.scrollHeight;
            const inputHeight = (inputEl && !inputEl.classList.contains('hidden')) ? inputEl.offsetHeight : 0;

            const idealHeight = headerHeight + responseHeight + inputHeight;

            // A full coded solution does not fit in 700px. Grow to most of the screen instead,
            // and stop growing once the user has sized the window themselves (the main process
            // ignores these requests from then on).
            const screenLimit = Math.round((window.screen?.availHeight || 900) * 0.85);
            const targetHeight = Math.min(Math.max(320, screenLimit), idealHeight);

            window.api.askView.adjustWindowHeight("ask", targetHeight);

        }).catch(err => console.error('AskView adjustWindowHeight error:', err));
    }

    // Throttled wrapper to avoid excessive IPC spam (executes at most once per animation frame)
    adjustWindowHeightThrottled() {
        if (this.isThrottled) return;

        this.isThrottled = true;
        requestAnimationFrame(() => {
            this.adjustWindowHeight();
            this.isThrottled = false;
        });
    }
}

customElements.define('ask-view', AskView);
