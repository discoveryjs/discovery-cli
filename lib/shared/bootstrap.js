const path = require('path');
const configUtils = require('./config');

function preprocessConfigFile(configFile) {
    return configFile
        ? path.relative(process.cwd(), configFile).replace(/^(?=[^.\/])/, './')
        : null;
}

module.exports = fn => Object.assign(async options => {
    const { configFile, config } = await configUtils.loadConfigWithFallback(options);

    return fn(options || {}, config, preprocessConfigFile(configFile));
}, { fn });

module.exports.model = fn => Object.assign(module.exports((options, config, configFile) => {
    const { model } = options;

    if (!model) {
        console.error('Model name is not specified. Use `--model` option to specify a model');
        process.exit(2);
    }

    const modelConfig = config.models[0];

    if (!modelConfig) {
        console.error(
            'Model `' + model + '` is not found in config. ' +
            'Available models: ' +
                (config.models.length ? config.models.map(model => model.slug).join(', ') : '<no model is available>')
        );
        process.exit(2);
    }

    return fn(modelConfig, options, config, configFile);
}), { fn });
