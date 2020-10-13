const fs = require('fs');
const path = require('path');
const { logSlugMsg, logSlugError, runScript, prettyDuration } = require('./utils');
const { getCaches, getActualCache } = require('./cache');
const cacheCommand = path.join(__dirname, '../../bin/cache');
const MIN = 60 * 1000;

function getCachePromise(slug, { configFile, cacheDir, prettyData, force }) {
    const args = [];

    if (!slug) {
        return Promise.resolve('null');
    }

    args.push('--model', slug);

    if (configFile) {
        args.push('--config', configFile);
    }

    if (cacheDir) {
        args.push('--cache-dir', cacheDir);
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
            const modelConfig = modelsUsingCache.get(slug);
            const cache = getCachePromise(slug, { configFile, cacheDir, prettyData, force: true })
                .finally(() => {
                    writeCacheRequest.delete(slug);
                });

            cache.then(() => {
                ignoreActualCache.delete(slug); // remove ignore on success only

                if (bgUpdateModels.includes(modelConfig) && !bgUpdateInProgress.has(slug)) {
                    scheduleBgUpdate(modelConfig); // re-schedule bg update on success only
                }
            });

            writeCacheRequest.set(slug, cache);
        }

        if (ignoreActual) {
            ignoreActualCache.add(slug);
        }

        return writeCacheRequest.get(slug);
    };

    // background update
    const bgUpdateModels = [...modelsUsingCache.values()].filter(model => model.cacheBgUpdate);
    const bgUpdateTimers = new Map();
    const bgUpdateInProgress = new Set();
    const scheduleBgUpdate = (modelConfig) => {
        const { slug, cacheBgUpdate } = modelConfig;
        const hasTimer = bgUpdateTimers.has(slug);

        if (hasTimer) {
            clearTimeout(bgUpdateTimers.get(slug));
        }

        logSlugMsg(slug, `${hasTimer ? 'Re-schedule' : 'Schedule'} background cache update in ${prettyDuration(cacheBgUpdate, true)}`);
        bgUpdateTimers.set(slug, setTimeout(
            () => {
                const bgUpdateStartTime = Date.now();

                logSlugMsg(slug, 'Start background cache update');
                bgUpdateInProgress.add(slug);

                writeCache(slug)
                    .then(
                        () => logSlugMsg(slug, `Background cache update done in ${prettyDuration(Date.now() - bgUpdateStartTime)}`),
                        (error) => logSlugError(slug, 'Background cache update error:') || console.error(require('chalk').redBright(error))
                    )
                    .then(() => {
                        bgUpdateInProgress.delete(slug);
                        bgUpdateTimers.delete(slug);
                        scheduleBgUpdate(modelConfig);
                    });
            },
            cacheBgUpdate
        ));
    };

    // clean up obsolete caches
    const cleanupObsoleteCaches = function() {
        for (const modelCaches of Object.values(getCaches(cacheDir, models))) {
            for (const { slug, file } of modelCaches.slice(2)) {
                fs.unlink(file, (err) => {
                    if (err) {
                        logSlugError(slug, `Delete obsolete cache "${path.relative(process.cwd(), file)}" error:`, err);
                    } else {
                        logSlugMsg(slug, `Obsolete cache deleted: ${path.relative(process.cwd(), file)}`);
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
