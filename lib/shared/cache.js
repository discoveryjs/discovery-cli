const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const esbuild = require('esbuild');
const crypto = require('crypto');
const { logSlugMsg, logSlugError, runScript, prettyDuration, serializeErrorForClient } = require('./utils');
const cacheCommand = path.join(__dirname, '../../bin/cache');
const matchCacheFilename = /(?:^|\/)\.discoveryjs\.(.*?)\.(\d+)\.?([a-f0-9]+)?\.cache$/;
const MIN = 60 * 1000;

function getDataHash(modelConfig) {
    const time = Date.now();
    const entrypoint = require.resolve(modelConfig.data);

    const { outputFiles: [{ contents }] } = esbuild.buildSync({
        entryPoints: [entrypoint],
        platform: 'node',
        globalName: 'process',
        bundle: true,
        write: false
    });

    const res =  crypto.createHash('sha1')
        .update(contents)
        .digest('hex');

    console.log('Cache created', Date.now() - time);

    return res;
}

function genCacheFilename(modelConfig, hash) {
    const { slug, cache } = modelConfig;
    const dict = new Map([
        ['slug', slug],
        ['timestamp', Date.now()]
    ]);

    if (hash) {
        dict.set('hash', hash);
    }

    return cache && cache.replace(/\[(\S+?)\]\./g, (m, key) => dict.has(key) ? dict.get(key) + '.' : '');
}

function genCacheInfo(filename, stat = fs.statSync(filename)) {
    const [, slug, timestamp, hash] = filename.match(matchCacheFilename) || [];

    return {
        slug,
        file: filename,
        size: stat.size,
        timestamp: Number(timestamp),
        hash
    };
}

function getActualCache(modelConfig, hash) {
    const { slug, cache } = modelConfig;
    const cacheFiles = getCaches(path.dirname(cache), [modelConfig])[slug] || [];

    const cacheCandidate = cacheFiles[0];

    if (cacheCandidate && (!modelConfig.cacheTtl || modelConfig.cacheTtl > Date.now() - cacheCandidate.timestamp)) {
        if (!hash || cacheCandidate.hash === hash) {
            return cacheCandidate;
        }
    }

    return null;
};

function getCaches(cachedir, models) {
    const cachesByModel = Object.fromEntries(models.map(model => [model.slug, []]));

    if (!fs.existsSync(cachedir)) {
        return cachesByModel;
    }

    for (const file of fs.readdirSync(cachedir)) {
        const fullPath = path.join(cachedir, file);
        const cacheInfo = genCacheInfo(fullPath);
        const { slug } = cacheInfo;
        const modelConfig = slug && models.find(model => model.slug === slug);

        if (modelConfig) {
            cachesByModel[slug].push(cacheInfo);
        }
    }

    for (const caches of Object.values(cachesByModel)) {
        caches.sort((a, b) => b.timestamp - a.timestamp);
    }

    return cachesByModel;
}

function runCacheCommand(slug, { configFile, cachedir, prettyData, hash }) {
    const args = [
        '--model', slug,
        '--mode', 'force'
    ];

    if (configFile) {
        args.push('--config', configFile);
    }

    if (cachedir) {
        args.push('--cachedir', cachedir);
    }

    if (prettyData) {
        args.push('--pretty', JSON.stringify(prettyData));
    }

    if (hash) {
        args.push('--hash', hash);
    }

    return runScript(cacheCommand, args);
}

function createCacheDispatcher(models, { configFile, cachedir, bgUpdate, prettyData, cachePersistent }) {
    const cacheBySlug = new Map(models
        .filter(model => model.slug && model.cache)
        .map(model => [model.slug, {
            model,
            bgUpdate: (bgUpdate && model.cacheBgUpdate) || false,
            bgUpdateTimer: null,
            hash: null,
            read: {
                ignoreActual: false,
                requests: 0,
                hits: 0
            },
            write: {
                requests: 0,
                writes: 0,
                errors: 0,
                lastErrorDateTime: null,
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
            const actualCache = getActualCache(modelCache.model, modelCache.hash);

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
            const cache = runCacheCommand(slug, { configFile, cachedir, prettyData, hash: modelCache.hash })
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
                modelCache.write.lastErrorDateTime = new Date();
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
        for (const fsModelCaches of Object.values(getCaches(cachedir, models))) {
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

    if (cachePersistent) {
        for (const [slug, modelCache] of cacheBySlug) {
            logSlugMsg(slug, `Calculating checksum for ${slug} model`);

            modelCache.hash = getDataHash(modelCache.model);
        }
    }

    return {
        used: cacheBySlug.size > 0,
        read: readCache,
        write: writeCache,
        warmup(slug) {
            const { model, hash } = cacheBySlug.get(slug);
            return getActualCache(model, hash)
                ? Promise.resolve()
                : writeCache(slug).then(() => {});
        },
        startBgUpdatesAndSync() {
            setInterval(cleanupObsoleteCaches, MIN);

            for (const modelCache of cacheBySlug.values()) {
                if (modelCache.bgUpdate) {
                    scheduleBgUpdate(modelCache);
                }
            }
        },
        stat() {
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
                        hash: modelCache.hash,
                        read: {
                            ...modelCache.read
                        },
                        write: {
                            processing: writeCacheRequest.has(slug),
                            ...modelCache.write,
                            lastError: lastWriteError
                                ? serializeErrorForClient(lastWriteError.stack || lastWriteError)
                                : null
                        }
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
