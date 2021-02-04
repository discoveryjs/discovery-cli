const utils = require('../shared/utils');
const command = require('../shared/commands');

module.exports = function prebuild(options) {
    const args = [];

    if (options.configFile) {
        args.push(options.configFile);
    }

    if (options.model) {
        args.push('--model', options.model);
    }

    if (options.modelDownload) {
        args.push('--model-download');
    }

    if (options.modelResetCache) {
        args.push('--model-reset-cache');
    }

    args.push('--output', options.prebuild);
    args.push('--no-data');
    // args.push('--cleanup');

    return utils.runScript(command.build, args);
};
