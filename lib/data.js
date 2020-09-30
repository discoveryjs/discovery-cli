const fs = require('fs');
const { stringifyInfo: jsonInfo, stringifyStream: createJsonStringifyStream } = require('@discoveryjs/json-ext');
const bootstrap = require('./shared/bootstrap');
const getCacheFilename = require('./shared/get-cache-filename');
const ensureDir = require('./shared/ensure-dir');

function collectData(modelConfig) {
    const startTime = Date.now();
    let fetchData = typeof modelConfig.data === 'function'
        ? modelConfig.data
        : () => {};

    return Promise.resolve(fetchData()).then(data => ({
        name: modelConfig.name,
        createdAt: new Date().toISOString(),
        elapsedTime: Date.now() - startTime,
        data
    }));
}

function getData(modelConfig, { rewriteCache, warmup, pretty } = {}) {
    const cacheFile = getCacheFilename(modelConfig);

    if (!cacheFile && warmup) {
        // do nothing when warmup mode and no cache is set up
        return Promise.resolve();
    }

    if (cacheFile && !rewriteCache) {
        // cache is set up
        try {
            const stat = fs.statSync(cacheFile);
            const cacheAge = Date.now() - stat.mtime;

            if (!modelConfig.cacheTtl || modelConfig.cacheTtl > cacheAge) {
                // cache is up to date, no updates needed

                if (warmup) {
                    // do nothing when warmup mode
                    return Promise.resolve();
                }

                // try to read from a cache
                return Promise.resolve({
                    stream: fs.createReadStream(cacheFile),
                    size: stat.size
                });
            }
        } catch (e) {}
    }

    return collectData(modelConfig).then(data => {
        const jsonStream = createJsonStringifyStream(data, null, pretty || undefined);

        if (cacheFile) {
            const startWriteTime = Date.now();
            const writeToFileStream = jsonStream
                .pipe(fs.createWriteStream(ensureDir(cacheFile)))
                .on('finish', () => {
                    console.log('[cache]', modelConfig.slug, 'cache written in', Date.now() - startWriteTime, 'ms');
                });

            if (warmup) {
                // await writing to file in warmup mode
                return new Promise((resolve, reject) => {
                    writeToFileStream
                        .on('finish', resolve)
                        .on('error', reject);
                });
            }
        }

        const result = { stream: jsonStream };

        const dataInfo = jsonInfo(data);

        if (!dataInfo.async.length && !dataInfo.circular.length) {
            result.size = dataInfo.minLength;
        }

        return result;
    });
}

module.exports = bootstrap(function(options, config) {
    const { model, rewriteCache, pretty, warmup } = options;

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

    return getData(modelConfig, { rewriteCache, pretty, warmup });
});
