const fs = require('fs');
const os = require('os');
const path = require('path');
const chalk = require('chalk');
const cron = require('cron-parser');
const esbuild = require('esbuild');
const crypto = require('crypto');
const { logError, logMsg, logSlugMsg, logSlugError, runScript, prettyDuration, serializeErrorForClient } = require('./utils');
const command = require('./commands');
const matchCacheFilename = /^\.discoveryjs\.(.*?)\.(\d+)\.?([a-f0-9]+)?\.cache$/;
const OBSOLETE_CACHE_CHECK_INTERVAL = 60 * 1000; // 1 min
const TMP_CACHE_FILE_TTL = 60 * 60 * 1000; // 1 hour
const TMP_CACHE_EXTNAME = '.discoveryjs-cache-tmp';

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
        external: ['*.json'],
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

function getPrevModelCacheTimestamp(modelCache, cacheInfo) {
    const { ttl } = modelCache;

    switch (typeof ttl) {
        case 'string': {
            cacheInfo = cacheInfo || getModelLastCache(modelCache);

            const options = {
                currentDate: cacheInfo.timestamp || Date.now(),
                utc: true
            };

            return cron.parseExpression(ttl, options).prev().getTime();
        }

        case 'number': {
            if (ttl > 0) {
                cacheInfo = cacheInfo || getModelLastCache(modelCache);

                if (cacheInfo) {
                    return Math.max(cacheInfo.timestamp, Date.now() - ttl);
                }

                return Date.now();
            }
        }
    }

    return null;
}

function getNextModelCacheTimestamp(modelCache, cacheInfo) {
    const { ttl } = modelCache;

    switch (typeof ttl) {
        case 'string': {
            cacheInfo = cacheInfo || getModelLastCache(modelCache);

            const options = {
                currentDate: cacheInfo.timestamp || Date.now(),
                utc: true
            };

            return cron.parseExpression(ttl, options).next().getTime();
        }

        case 'number': {
            if (ttl > 0) {
                cacheInfo = cacheInfo || getModelLastCache(modelCache);

                if (cacheInfo) {
                    return cacheInfo.timestamp + ttl;
                }

                return Date.now();
            }
        }
    }

    return null;
}

function getCacheFileInfo(filename, stat) {
    const basename = path.basename(filename);

    if (!matchCacheFilename.test(basename) || !fs.existsSync(filename)) {
        return null;
    }

    const [, slug, timestamp, hash] = basename.match(matchCacheFilename);

    if (!stat) {
        stat = fs.statSync(filename);
    }

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

function getModelLastCache({ slug, file }) {
    const caches = getCaches(path.dirname(file), [slug])[slug] || [];
    return caches[0] || null;
}

function getModelActualCache(modelCache, checkTtl) {
    const { hash } = modelCache;
    const cacheCandidate = getModelLastCache(modelCache);

    if (!cacheCandidate) {
        return null;
    }

    // cache hash doesn't match to model's hash
    if (hash && cacheCandidate.hash !== hash) {
        return null;
    }

    // out of date
    if (checkTtl) {
        const timestamp = getPrevModelCacheTimestamp(modelCache, cacheCandidate);
        if (timestamp && timestamp > cacheCandidate.timestamp) {
            return null;
        }
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

        if (cacheInfo !== null) {
            const { slug } = cacheInfo;

            if (slug && modelSlugs.includes(slug)) {
                cachesByModel[slug].push(cacheInfo);
            }
        }
    }

    // sort by timestamp in descending order
    for (const caches of Object.values(cachesByModel)) {
        caches.sort((a, b) => b.timestamp - a.timestamp);
    }

    return cachesByModel;
}

function runCacheCommand(slug, { configFile, cachedir, tmpdir, prettyData, hash }) {
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

    if (tmpdir) {
        args.push('--tmpdir', tmpdir);
    }

    if (prettyData) {
        args.push('--pretty', JSON.stringify(prettyData));
    }

    if (hash) {
        args.push('--hash', hash);
    }

    return runScript(command.cache, args);
}

function createCacheDispatcher(models, options) {
    const {
        configFile,
        cache = true,
        checkCacheTtl: checkTtl = true,
        bgUpdate,
        modelResetCache,
        prettyData,
        cachePersistent
    } = options;
    let {
        cachedir,
        tmpdir
    } = options;

    const modelSlugs = [];
    const cacheBySlug = new Map();

    // create mode cache descriptor
    const createModelCache = (model) => {
        const modelCache = {
            slug: model.slug,
            model,
            file: path.resolve(cachedir, '.discoveryjs.[slug].[timestamp].[hash].cache'),
            ttl: model.cacheTtl || false,
            manualReset: modelResetCache && model.cacheBgUpdate !== 'only',
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
                lastErrorDate: null,
                lastError: null,
                lastDate: null,
                lastAwaited: null,
                lastElapsed: null
            }
        };

        if (cachePersistent) {
            if (cachePersistent === true) {
                Object.defineProperty(modelCache, 'hash', {
                    configurable: true,
                    get() { // lazy computed property
                        // override with a computed value
                        Object.defineProperty(modelCache, 'hash', {
                            value: getDataHash(modelCache.model)
                        });

                        return modelCache.hash;
                    }
                });
            } else {
                modelCache.hash = cachePersistent;
            }
        }

        return modelCache;
    };

    // add/remove model
    const addModel = (model) => {
        if (!cache || !model.slug) {
            return;
        }

        const { slug } = model;

        if (modelSlugs.includes(slug)) {
            removeModel(slug);
        }

        modelSlugs.push(slug);

        if (model.cache && model.data) {
            const modelCache = createModelCache(model);
            cacheBySlug.set(slug, modelCache);

            if (cleanupObsoleteCachesTimer && modelCache.bgUpdate) {
                scheduleBgUpdate(modelCache, true);
            }
        }
    };
    const removeModel = (slug) => {
        const modelCache = cacheBySlug.get(slug);

        if (modelCache) {
            cacheBySlug.delete(slug);
            writeCacheRequest.delete(slug);

            if (modelCache.bgUpdateTimer) {
                clearTimeout(modelCache.bgUpdateTimer);
            }
        }

        modelSlugs = modelSlugs.filter(entry => entry !== slug);
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
            manualReset: modelCache.manualReset,
            bgUpdate: modelCache.bgUpdate,
            bgUpdateScheduled: modelCache.bgUpdateScheduled,
            get hash() {
                return modelCache.hash || false; // since hash is lazy evaluated
            },
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

    // get cache requests
    const readCache = (slug) => {
        const modelCache = cacheBySlug.get(slug);

        if (!modelCache) {
            if (modelSlugs.includes(slug)) {
                return Promise.resolve(null);
            }

            return Promise.reject(`No model with slug "${slug}" is found`);
        }

        modelCache.read.requests++;

        if (!modelCache.read.ignoreActual) {
            const actualCache = getModelActualCache(modelCache, checkTtl);

            if (actualCache) {
                modelCache.read.hits++;
                return Promise.resolve(actualCache);
            }
        }

        return writeCache(slug);
    };
    const writeCacheRequest = new Map();
    let writeCacheLast = Promise.resolve(); // to avoid data cache updates in parallel (out of resources)
    const writeCache = (slug, ignoreActual) => {
        const modelCache = cacheBySlug.get(slug);

        if (!modelCache) {
            return Promise.reject(`No model with slug "${slug}" is found`);
        }

        modelCache.write.requests++;

        if (!writeCacheRequest.has(slug)) {
            const startTime = Date.now();
            let awaitTime;
            const cache = writeCacheLast
                .then(() => {
                    awaitTime = Date.now() - startTime;
                    return runCacheCommand(slug, { configFile, cachedir, tmpdir, prettyData, hash: modelCache.hash });
                })
                .finally(() => {
                    writeCacheRequest.delete(slug);
                    modelCache.write.lastAwaited = awaitTime;
                    modelCache.write.lastElapsed = Date.now() - startTime - awaitTime;
                    modelCache.write.lastDate = new Date();
                });

            modelCache.write.writes++;
            writeCacheLast = cache.then(cacheInfo => {
                modelCache.read.ignoreActual = false; // remove ignore on success only

                if (modelCache.bgUpdateTimer) {
                    scheduleBgUpdate(modelCache, cacheInfo); // re-schedule bg update on success only
                }
            }, (error) => {
                modelCache.write.lastErrorDateTime = new Date();
                modelCache.write.lastError = error;
                modelCache.write.errors++;
            }).catch((error) => {
                logSlugError(slug, 'Finalize cache generation error:', error);
            }).finally(() => {
                logMsg(`Data cache updating queue${writeCacheRequest.size ? ': ' + writeCacheRequest.size + ' left' : ' is empty'}`);
            });

            writeCacheRequest.set(slug, cache);
        }

        if (ignoreActual) {
            modelCache.read.ignoreActual = true;
        }

        return writeCacheRequest.get(slug);
    };

    // background update
    let cleanupObsoleteCachesTimer = null;
    const scheduleBgUpdate = (modelCache, cacheInfo) => {
        const { slug, bgUpdate, bgUpdateTimer } = modelCache;

        if (bgUpdateTimer) {
            clearTimeout(bgUpdateTimer);
        }

        if (!bgUpdate) {
            return;
        }

        const nextTimestamp = getNextModelCacheTimestamp(modelCache, cacheInfo);

        if (nextTimestamp === null) {
            return;
        }

        const awaitTime = Math.max(0, nextTimestamp - Date.now());
        const awaitDate = new Date(Date.now() + awaitTime);
        const awaitTimeHuman = !awaitTime
            ? 'asap'
            : `in ${
                prettyDuration(awaitTime, { secondsDecimalDigits: 0, spaces: true })
            } (${awaitDate.toISOString().replace(/[TZ]/g, ' ')}GMT)`;

        logSlugMsg(slug, `${bgUpdateTimer ? 'Re-schedule' : 'Schedule'} background data cache update ${awaitTimeHuman}`);

        modelCache.bgUpdateScheduled = awaitDate;
        modelCache.bgUpdateTimer = setTimeout(
            () => {
                const bgUpdateStartTime = Date.now();

                logSlugMsg(slug, 'Queue background data cache update');
                modelCache.bgUpdateTimer = null;

                writeCache(slug)
                    .then((cacheInfo) => {
                        logSlugMsg(slug, `Background data cache update done in ${prettyDuration(Date.now() - bgUpdateStartTime)}`);

                        // make sure that modelCache is still actual descriptor
                        if (modelCache === cacheBySlug.get(slug)) {
                            scheduleBgUpdate(modelCache, cacheInfo);
                        }
                    })
                    .catch((error) => {
                        logSlugError(slug, 'Background data cache update error:', error);

                        // make sure that modelCache is still actual descriptor
                        if (modelCache === cacheBySlug.get(slug)) {
                            // there is no cacheInfo since cache generation failed, but we need to schedule next try
                            scheduleBgUpdate(modelCache, { timestamp: Date.now() });
                        }
                    });
            },
            awaitTime
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

        // clean *.tmp files
        for (const file of fs.readdirSync(tmpdir)) {
            if (path.extname(file) !== TMP_CACHE_EXTNAME) {
                continue;
            }

            const filePath = path.join(tmpdir, file);
            const { mtime } = fs.statSync(filePath);

            if (Date.now() - Date.parse(mtime) > TMP_CACHE_FILE_TTL) {
                fs.unlink(path.join(tmpdir, file), (err) => {
                    err && logError(err);
                });
            }
        }
    };

    // normalize paths
    cachedir = path.resolve(process.cwd(), cachedir);
    tmpdir = path.resolve(process.cwd(), tmpdir || os.tmpdir());

    // add models
    models.forEach(addModel);

    // return API
    return {
        cache,
        cachedir,
        tmpdir,
        checkTtl,
        get used() {
            return cacheBySlug.size > 0;
        },
        read: readCache,
        reset(slug) {
            const modelCache = cacheBySlug.get(slug);

            if (!modelCache) {
                return Promise.reject(`No model with slug "${slug}" is found`);
            }

            if (!modelCache.manualReset) {
                return Promise.reject(`No reset cache for "${slug}" model is enabled`);
            }

            return writeCache(slug, true);
        },
        addModel,
        removeModel,
        getModelCacheInfo,
        genModelCacheFilename(slug) {
            return genModelCacheFilename(cacheBySlug.get(slug));
        },
        genModelCacheTempFilename(slug) {
            return genModelCacheFilename(cacheBySlug.get(slug)) + TMP_CACHE_EXTNAME;
        },
        getModelActualCache(slug) {
            return cacheBySlug.has(slug)
                ? getModelActualCache(cacheBySlug.get(slug), checkTtl)
                : null;
        },
        warmup(slug) {
            return getModelActualCache(cacheBySlug.get(slug), false)
                ? Promise.resolve()
                : writeCache(slug).catch(() => {
                    // avoid uncaught rejection warnings
                });
        },
        startBgUpdatesAndSync() {
            const stat = [];

            clearInterval(cleanupObsoleteCachesTimer);
            cleanupObsoleteCachesTimer = setInterval(cleanupObsoleteCaches, OBSOLETE_CACHE_CHECK_INTERVAL);

            for (const modelCache of cacheBySlug.values()) {
                if (modelCache.bgUpdate) {
                    scheduleBgUpdate(modelCache);

                    stat.push({
                        slug: modelCache.slug,
                        scheduled: modelCache.bgUpdateScheduled
                    });
                }
            }

            return stat;
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
