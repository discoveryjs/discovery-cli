const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { runScript, prettyDuration, time } = require('./utils');
const { getCaches, getActualCache } = require('./cache');
const cacheCommand = path.join(__dirname, '../../bin/cache');
const logMsg = (route, ...args) => console.log(chalk.grey(time()), chalk.cyan(route), ...args);
const logError = (route, ...args) => console.error(chalk.grey(time()), chalk.cyan(route), ...args);
const MIN = 60 * 1000;

function getCachePromise(slug, { configFile, prettyData, force }) {
    const args = [];

    if (!slug) {
        return Promise.resolve('null');
    }

    args.push('--model', slug);

    if (configFile) {
        args.push('--config', configFile);
    }

    if (prettyData) {
        args.push('--pretty', JSON.stringify(prettyData));
    }

    if (force) {
        args.push('--mode', 'force');
    }

    return runScript(cacheCommand, args);
}

module.exports = function createCacheDispatcher(models, { configFile, cacheDir, prettyData }) {
    const modelsUsingCache = new Map(models.filter(model => model.cache).map(model => [model.slug, model]));

    // get cache requests
    const ignoreActualCache = new Set();
    const writeCacheRequest = new Map();
    const readCache = (slug) => {
        if (!modelsUsingCache.has(slug)) {
            return Promise.resolve();
        }

        return ignoreActualCache.has(slug)
            ? writeCache(slug)
            : Promise.resolve(getActualCache(modelsUsingCache.get(slug)) || writeCache(slug));
    };
    const writeCache = (slug, ignoreActual) => {
        if (!modelsUsingCache.has(slug)) {
            return Promise.resolve();
        }

        if (!writeCacheRequest.has(slug)) {
            const cache = getCachePromise(slug, { configFile, prettyData, force: true })
                .finally(() => {
                    ignoreActualCache.delete(slug);
                    writeCacheRequest.delete(slug);
                });

            writeCacheRequest.set(slug, cache);
        }

        if (ignoreActual) {
            ignoreActualCache.add(slug);
        }

        return writeCacheRequest.get(slug);
    };

    // background update
    const bgUpdateModels = models.filter(model => modelsUsingCache.has(model.slug) && model.cacheBgUpdate);
    const scheduleBgUpdate = (modelConfig) => {
        const { slug, cacheBgUpdate } = modelConfig;

        logMsg(slug, `Schedule update cache in background in ${prettyDuration(cacheBgUpdate, true)}`);
        setTimeout(
            () => {
                const bgUpdateStartTime = Date.now();
                logMsg(slug, 'Start background cache update');
                writeCache(slug)
                    .then(
                        () => logMsg(slug, `Background cache update done in ${prettyDuration(Date.now() - bgUpdateStartTime)}`),
                        (error) => logError(slug, `Background cache update error: ${error}`)
                    )
                    .then(() => scheduleBgUpdate(modelConfig));
            },
            cacheBgUpdate
        );
    };

    // clean up obsolete caches
    const cleanupObsoleteCaches = function() {
        for (const modelCaches of Object.values(getCaches(cacheDir, models))) {
            for (const { slug, file } of modelCaches.slice(2)) {
                fs.unlink(file, (err) => {
                    if (err) {
                        logError(slug, `Delete obsolete cache "${file}" error:`, err);
                    } else {
                        logMsg(slug, `Obsolete cache deleted: ${file}`);
                    }
                });
            }
        }
    };

    return {
        read: readCache,
        write: writeCache,
        get used() {
            return modelsUsingCache.size > 0;
        },
        startBgUpdatesAndSync() {
            setInterval(cleanupObsoleteCaches, MIN);

            for (const modelConfig of bgUpdateModels) {
                scheduleBgUpdate(modelConfig);
            }
        }
    };
};
