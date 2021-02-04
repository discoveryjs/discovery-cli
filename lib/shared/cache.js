const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const esbuild = require('esbuild');
const crypto = require('crypto');
const { logSlugMsg, logSlugError, runScript, prettyDuration, serializeErrorForClient, logMsg } = require('./utils');
const command = require('./commands');
const matchCacheFilename = /(?:^|\/)\.discoveryjs\.(.*?)\.(\d+)\.?([a-f0-9]+)?\.cache$/;
const OBSOLETE_CACHE_CHECK_INTERVAL = 60 * 1000; // 1 min

function getDataHash(modelConfig) {
    const { slug, data } = modelConfig;

    if (typeof data !== 'string') {
        if (data) {
            logSlugError(slug, 'Model\'s options.data value must be a string when --cache-persistent is used, a data hash is not used');
        }

        return false;
    }

    logSlugMsg(slug, 'Calculate model\'s data hash');

    const time = Date.now();
    const { outputFiles: [{ contents }] } = esbuild.buildSync({
        entryPoints: [data],
        platform: 'node',
        globalName: 'process',
        bundle: true,
        write: false
    });

    const hash = crypto.createHash('sha1')
        .update(contents)
        .digest('hex')
        .slice(0, 12);

    logSlugMsg(slug, 'Data hash', hash, 'computed in', Date.now() - time);

    return hash;
}

function getCacheFileInfo(filename, stat = fs.statSync(filename)) {
    const [, slug, timestamp, hash] = filename.match(matchCacheFilename) || [];

    return {
        slug,
        file: filename,
        size: stat.size,
        timestamp: Number(timestamp),
        hash: hash || false
    };
}

function genModelCacheFilename({ slug, file, hash }) {
    if (!file) {
        return null;
    }

    const dict = new Map([
        ['slug', slug],
        ['timestamp', Date.now()]
    ]);

    if (hash) {
        dict.set('hash', hash);
    }

    return file.replace(/\[(\S+?)\]\./g, (m, key) => dict.has(key) ? dict.get(key) + '.' : '');
}

function getModelActualCache({ slug, file, ttl, hash }) {
    const [cacheCandidate] = getCaches(path.dirname(file), [slug])[slug] || [];

    if (!cacheCandidate) {
        return null;
    }

    // out of date
    if (ttl && ttl < Date.now() - cacheCandidate.timestamp) {
        return null;
    }

    // cache hash doesn't match to model's hash
    if (hash && cacheCandidate.hash !== hash) {
        return null;
    }

    return cacheCandidate;
};

function getCaches(cachedir, modelSlugs) {
    const cachesByModel = Object.fromEntries(modelSlugs.map(slug => [slug, []]));

    if (!fs.existsSync(cachedir)) {
        return cachesByModel;
    }

    for (const filepath of fs.readdirSync(cachedir)) {
        const cacheInfo = getCacheFileInfo(path.join(cachedir, filepath));
        const { slug } = cacheInfo;

        if (slug && modelSlugs.includes(slug)) {
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

    return runScript(command.cache, args);
}

function createCacheDispatcher(models, { configFile, cache = true, cachedir, bgUpdate, prettyData, cachePersistent }) {
    const modelSlugs = models.map(({ slug }) => slug).filter(Boolean);
    const cacheBySlug = new Map(models
        .filter(model => cache && model.slug && model.cache)
        .map(model => [model.slug, {
            slug: model.slug,
            model,
            file: path.resolve(cachedir, path.basename(model.cache)),
            ttl: model.cacheTtl || false,
            bgUpdate: (bgUpdate && model.cacheBgUpdate) || false,
            bgUpdateTimer: null,
            bgUpdateScheduled: false,
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
            const actualCache = getModelActualCache(modelCache);

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
    const scheduleBgUpdate = (modelCache, init) => {
        const { slug, bgUpdate, bgUpdateTimer } = modelCache;

        if (bgUpdateTimer) {
            clearTimeout(bgUpdateTimer);
        }

        !init && logSlugMsg(slug, `${bgUpdateTimer ? 'Re-schedule' : 'Schedule'} background data cache update in ${prettyDuration(bgUpdate, true)}`);
        modelCache.bgUpdateScheduled = new Date(Date.now() + bgUpdate);
        modelCache.bgUpdateTimer = setTimeout(
            () => {
                const bgUpdateStartTime = Date.now();

                logSlugMsg(slug, 'Start background data cache update');
                modelCache.bgUpdateTimer = null;

                writeCache(slug)
                    .then(
                        () => logSlugMsg(slug, `Background data cache update done in ${prettyDuration(Date.now() - bgUpdateStartTime)}`),
                        (error) => logSlugError(slug, 'Background data cache update error:', error)
                    )
                    .then(() => {
                        scheduleBgUpdate(modelCache);
                    });
            },
            bgUpdate
        );
    };

    // clean up obsolete caches
    const cleanupObsoleteCaches = () => {
        for (const fsModelCaches of Object.values(getCaches(cachedir, modelSlugs))) {
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

    // model cache info
    const getModelCacheInfo = (slug) => {
        const modelCache = cacheBySlug.get(slug);

        if (!modelCache) {
            return {
                slug,
                cache: false
            };
        }

        const lastWriteError = modelCache.write.lastError;

        return {
            slug,
            cache: modelCache.file,
            ttl: modelCache.ttl,
            bgUpdate: modelCache.bgUpdate,
            bgUpdateScheduled: modelCache.bgUpdateScheduled,
            hash: modelCache.hash || false,
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
        };
    };

    if (cachePersistent) {
        for (const modelCache of cacheBySlug.values()) {
            Object.defineProperty(modelCache, 'hash', {
                get() { // lazy computed property
                    const value = getDataHash(modelCache.model);

                    // override with a computed value
                    Object.defineProperty(modelCache, 'hash', { value });

                    return value;
                }
            });
        }
    }

    return {
        cache,
        cachedir,
        used: cacheBySlug.size > 0,
        read: readCache,
        write: writeCache,
        getModelCacheInfo,
        genModelCacheFilename(slug) {
            return genModelCacheFilename(cacheBySlug.get(slug));
        },
        getModelActualCache(slug) {
            return cacheBySlug.has(slug)
                ? getModelActualCache(cacheBySlug.get(slug))
                : null;
        },
        warmup(slug) {
            return getModelActualCache(cacheBySlug.get(slug))
                ? Promise.resolve()
                : writeCache(slug).then(() => {});
        },
        startBgUpdatesAndSync() {
            setInterval(cleanupObsoleteCaches, OBSOLETE_CACHE_CHECK_INTERVAL);

            const stat = new Map();
            for (const modelCache of cacheBySlug.values()) {
                if (modelCache.bgUpdate) {
                    scheduleBgUpdate(modelCache, true);
                    stat.set(modelCache.bgUpdate, (stat.get(modelCache.bgUpdate) || []).concat(modelCache.slug));
                }
            }

            // output stat
            for (const [bgUpdate, slugs] of [...stat.entries()].sort(([a], [b]) => a - b)) {
                logMsg('every',
                    chalk.green(prettyDuration(bgUpdate).padStart(5)) + ' ',
                    slugs.map(slug => chalk.cyan(slug)).join(', ')
                );
            }
        },
        cacheFiles() {
            return [].concat(...Object.values(getCaches(cachedir, modelSlugs)));
        },
        stat() {
            return modelSlugs.map(getModelCacheInfo);
        }
    };
};

module.exports = {
    getCacheFileInfo,
    createCacheDispatcher
};
