const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { logSlugMsg, logSlugError, runScript, prettyDuration, serializeErrorForClient } = require('./utils');
const cacheCommand = path.join(__dirname, '../../bin/cache');
const matchCacheFilename = /(?:^|\/)\.discoveryjs\.(.*?)\.(\d+)\.cache$/;
const MIN = 60 * 1000;

function genCacheFilename(modelConfig) {
    const { slug, cache } = modelConfig;
    const dict = new Map([
        ['slug', slug],
        ['timestamp', Date.now()]
    ]);

    return cache && cache.replace(/\[(\S+?)\]/g, (m, key) => dict.has(key) ? dict.get(key) : m);
}

function genCacheInfo(slug, filename, stat = fs.statSync(filename)) {
    const [,, timestamp] = filename.match(matchCacheFilename) || [];

    return {
        slug,
        file: filename,
        size: stat.size,
        timestamp: Number(timestamp)
    };
}

function getActualCache(modelConfig) {
    const { slug, cache } = modelConfig;
    const cacheFiles = getCaches(path.dirname(cache), [modelConfig])[slug] || [];

    return cacheFiles[0];
};

function getCaches(cachedir, models, all) {
    const cachesByModel = Object.fromEntries(models.map(model => [model.slug, []]));

    if (!fs.existsSync(cachedir)) {
        return cachesByModel;
    }

    for (const file of fs.readdirSync(cachedir)) {
        const [, slug] = file.match(matchCacheFilename) || [];
        const modelConfig = slug && models.find(model => model.slug === slug);

        if (modelConfig) {
            const fullPath = path.join(cachedir, file);
            const stat = fs.statSync(fullPath);
            const cacheAge = Date.now() - stat.mtime;

            if (all || !modelConfig.cacheTtl || modelConfig.cacheTtl > cacheAge) {
                cachesByModel[slug].push(genCacheInfo(slug, fullPath, stat));
            }
        }
    }

    for (const caches of Object.values(cachesByModel)) {
        caches.sort((a, b) => b.timestamp - a.timestamp);
    }

    return cachesByModel;
}

function runCacheCommand(slug, { configFile, cacheDir, prettyData }) {
    const args = [
        '--model', slug,
        '--mode', 'force'
    ];

    if (configFile) {
        args.push('--config', configFile);
    }

    if (cacheDir) {
        args.push('--cache-dir', cacheDir);
    }

    if (prettyData) {
        args.push('--pretty', JSON.stringify(prettyData));
    }

    return runScript(cacheCommand, args);
}

function createCacheDispatcher(models, { configFile, cacheDir, prettyData }) {
    const cacheBySlug = new Map(models
        .filter(model => model.slug && model.cache)
        .map(model => [model.slug, {
            model,
            bgUpdate: model.cacheBgUpdate || false,
            bgUpdateTimer: null,
            read: {
                ignoreActual: false,
                requests: 0,
                hits: 0
            },
            write: {
                requests: 0,
                writes: 0,
                errors: 0,
                lastError: null,
                lastTime: null
            }
        }])
    );

    // get cache requests
    const writeCacheRequest = new Map();
    const readCache = (slug) => {
        const modelCache = cacheBySlug.get(slug);

        if (!modelCache) {
            return Promise.resolve();
        }

        modelCache.read.requests++;

        if (!modelCache.read.ignoreActual) {
            const actualCache = getActualCache(modelCache.model);

            if (actualCache) {
                modelCache.read.hits++;
                return Promise.resolve(actualCache);
            }
        }

        return writeCache(slug);
    };
    const writeCache = (slug, ignoreActual) => {
        const modelCache = cacheBySlug.get(slug);

        if (!modelCache) {
            return Promise.resolve();
        }

        modelCache.write.requests++;

        if (!writeCacheRequest.has(slug)) {
            const startTime = Date.now();
            const cache = runCacheCommand(slug, { configFile, cacheDir, prettyData })
                .finally(() => {
                    modelCache.write.lastTime = Date.now() - startTime;
                    writeCacheRequest.delete(slug);
                });

            modelCache.write.writes++;
            cache.then(() => {
                modelCache.read.ignoreActual = false; // remove ignore on success only

                if (modelCache.bgUpdateTimer) {
                    scheduleBgUpdate(modelCache); // re-schedule bg update on success only
                }
            }, (error) => {
                modelCache.write.lastError = error;
                modelCache.write.errors++;
            });

            writeCacheRequest.set(slug, cache);
        }

        if (ignoreActual) {
            modelCache.read.ignoreActual = true;
        }

        return writeCacheRequest.get(slug);
    };

    // background update
    const scheduleBgUpdate = (modelCache) => {
        const { model: { slug }, bgUpdate, bgUpdateTimer } = modelCache;

        if (bgUpdateTimer) {
            clearTimeout(bgUpdateTimer);
        }

        logSlugMsg(slug, `${bgUpdateTimer ? 'Re-schedule' : 'Schedule'} background cache update in ${prettyDuration(bgUpdate, true)}`);
        modelCache.bgUpdateTimer = setTimeout(
            () => {
                const bgUpdateStartTime = Date.now();

                logSlugMsg(slug, 'Start background cache update');
                modelCache.bgUpdateTimer = null;

                writeCache(slug)
                    .then(
                        () => logSlugMsg(slug, `Background cache update done in ${prettyDuration(Date.now() - bgUpdateStartTime)}`),
                        (error) => logSlugError(slug, 'Background cache update error:', error)
                    )
                    .then(() => {
                        scheduleBgUpdate(modelCache);
                    });
            },
            bgUpdate
        );
    };

    // clean up obsolete caches
    const cleanupObsoleteCaches = function() {
        for (const fsModelCaches of Object.values(getCaches(cacheDir, models))) {
            for (const { slug, file } of fsModelCaches.slice(2)) {
                fs.unlink(file, (err) => {
                    const relFilename = chalk.yellow(path.relative(process.cwd(), file));

                    if (err) {
                        logSlugError(slug, `Delete obsolete cache "${relFilename}" error:`, err);
                    } else {
                        logSlugMsg(slug, `Obsolete cache deleted: ${relFilename}`);
                    }
                });
            }
        }
    };

    return {
        used: cacheBySlug.size > 0,
        read: readCache,
        write: writeCache,
        startBgUpdatesAndSync() {
            setInterval(cleanupObsoleteCaches, MIN);

            for (const modelCache of cacheBySlug.values()) {
                if (modelCache.bgUpdate) {
                    scheduleBgUpdate(modelCache);
                }
            }
        },
        stat() {
            const cacheFiles = getCaches(cacheDir, models, true);

            return models.map(({ slug, cache, cacheTtl }) => {
                const modelCache = cacheBySlug.get(slug);
                const lastWriteError = modelCache && modelCache.write.lastError;

                return {
                    slug,
                    cache: cache && path.relative(process.cwd(), cache),
                    ...modelCache ? {
                        ttl: cacheTtl || false,
                        bgUpdate: modelCache.bgUpdate,
                        bgUpdateTimer: Boolean(modelCache.bgUpdateTimer),
                        read: {
                            ...modelCache.read
                        },
                        write: {
                            processing: writeCacheRequest.has(slug),
                            ...modelCache.write,
                            lastError: lastWriteError
                                ? serializeErrorForClient(lastWriteError.stack || lastWriteError)
                                : null
                        },
                        files: cacheFiles[slug].map(cache => ({
                            ...cache,
                            file: path.relative(process.cwd(), cache.file),
                            timestamp: new Date(cache.timestamp)
                        }))
                    } : null
                };
            });
        }
    };
};

module.exports = {
    genCacheFilename,
    genCacheInfo,
    getActualCache,
    getCaches,
    createCacheDispatcher
};
