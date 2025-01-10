const fs = require('fs');
const assert = require('assert');
const bootstrap = require('./shared/bootstrap');
const { createCacheDispatcher } = require('./shared/cache');
const gen = require('./shared/gen');
const { parseChunked } = require('@discoveryjs/json-ext');

module.exports = bootstrap(async function getData(options, config, configFile) {
    const modelConfig = options.model ? config.models[0] : null;
    const cacheDispatcher = createCacheDispatcher(config.models, { configFile, ...options });
    const getData = modelConfig
        ? () => {
            return cacheDispatcher.read(modelConfig.slug)
                .then(cache =>
                    cache
                        ? { ...cache, stream: fs.createReadStream(cache.file) }
                        : gen['/model.data'](modelConfig, options)
                )
                .then(({ stream }) => parseChunked(stream));
        }
        : () => null;
    const noscriptConfig = modelConfig
        ? modelConfig.view.noscript
        : config.view.noscript;
    let getNoscriptContent = null;
    let noscriptContent;

    switch (typeof noscriptConfig) {
        case 'function': {
            getNoscriptContent = noscriptConfig;
            break;
        }

        case 'string': {
            getNoscriptContent = require(noscriptConfig);

            assert(
                typeof getNoscriptContent === 'function',
                `Module "${noscriptConfig}" must export a function`
            );
            break;
        }

        default: {
            // default noscript for index page
            if (noscriptConfig === null && modelConfig === null) {
                getNoscriptContent = function(_, setup) {
                    return [
                        '<style>body { margin: 1em 30px }</style>',
                        '<h1>' + setup.name + '</h1>',
                        '<ul>',
                        ...setup.models.map(model => `<li><a href="${model.url.replace('index.html', '')}">${model.name}</a></li>`),
                        '</ul>'
                    ].join('\n');
                };
            }
        }
    }

    if (getNoscriptContent !== null) {
        const setupJson = await gen['/setup.json'](modelConfig, options, config, cacheDispatcher);
        let dataCache;

        noscriptContent = await getNoscriptContent(
            () => dataCache || (dataCache = getData()),
            JSON.parse(setupJson)
        );

        dataCache = null;
    }

    return noscriptContent;
});

