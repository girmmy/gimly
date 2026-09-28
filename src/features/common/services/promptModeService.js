const Store = require('electron-store');

/**
 * Which answer style Gimly uses. The live-meeting profile deliberately caps answers at a short
 * headline and ≤15-word bullets, which is right for a sales call and wrong for interview prep,
 * where a behavioral answer needs the whole story and a coding answer needs the whole solution.
 */
const MODES = {
    live: {
        id: 'live',
        label: 'Live meeting',
        description: 'Terse, glanceable answers for calls in progress',
        profile: 'gimly_analysis',
    },
    interview: {
        id: 'interview',
        label: 'Interview prep',
        description: 'Full behavioral answers and complete coded solutions',
        profile: 'interview_prep',
    },
};

const DEFAULT_MODE = 'live';

class PromptModeService {
    constructor() {
        this.store = new Store({ name: 'gimly-prompt-mode', defaults: { mode: DEFAULT_MODE } });
    }

    /** @returns {'live'|'interview'} */
    getMode() {
        const mode = this.store.get('mode', DEFAULT_MODE);
        return MODES[mode] ? mode : DEFAULT_MODE;
    }

    /** The prompt template the current mode maps to. */
    getProfile() {
        return MODES[this.getMode()].profile;
    }

    setMode(mode) {
        if (!MODES[mode]) {
            return { success: false, error: `Unknown mode: ${mode}` };
        }
        this.store.set('mode', mode);
        console.log(`[PromptMode] Mode set to "${mode}"`);
        return { success: true, mode };
    }

    listModes() {
        return Object.values(MODES).map(({ id, label, description }) => ({ id, label, description }));
    }
}

const promptModeService = new PromptModeService();

module.exports = promptModeService;
module.exports.MODES = MODES;
