const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { stringifyStream } = require('@discoveryjs/json-ext');
const { getCacheFileInfo, createCacheDispatcher } = require('./shared/cache');
const { logSlugMsg } = require('./shared/utils');
const bootstrap = require('./shared/bootstrap');
const ensureDir = require('./shared/ensure-dir');
const genData = require('./data');
const { pipeline } = require('./shared/data-pipeline');

// modes:
// - default – get cache or generate new one if not exists
// - readonly – get cache
// - force – generate cache (ignore existing)
module.exports = bootstrap.model(async function getCache(modelConfig, {
    configFile,
    cachedir,
    tmpdir,
    pretty: prettyData,
    hash: cachePersistent,
    mode,
    createPlanEventHandler
}) {
    const cacheDispatcher = createCacheDispatcher([modelConfig], {
        configFile,
        cachedir,
        tmpdir,
        prettyData,
        cachePersistent
    });

    const { slug } = modelConfig;
    const actualCache = mode !== 'force'
        ? cacheDispatcher.getModelActualCache(slug)
        : false;

    if (actualCache || mode === 'readonly') {
        return actualCache;
    }

    const tmpCacheFilename = path.join(cacheDispatcher.tmpdir, path.basename(cacheDispatcher.genModelCacheTempFilename(slug)));
    const writeCacheTask = pipeline.step('Write data to cache', (data) => new Promise((resolve, reject) => {
        logSlugMsg(slug, 'Data cache ready in', Date.now() - startTime, 'ms', `(pid: ${process.pid})`);

        const startWriteTime = Date.now();
        stringifyStream(data, null, prettyData)
            .on('error', reject)
            .pipe(fs.createWriteStream(ensureDir(tmpCacheFilename)))
            .on('error', reject)
            .on('finish', () => {
                const newCacheFilename = cacheDispatcher.genModelCacheFilename(slug);
                const relNewCacheFilename = chalk.yellow(path.relative(process.cwd(), newCacheFilename));

                fs.renameSync(tmpCacheFilename, ensureDir(newCacheFilename));
                logSlugMsg(slug, `Data cache file "${relNewCacheFilename}" written in`, Date.now() - startWriteTime, 'ms', `(pid: ${process.pid})`);

                resolve(getCacheFileInfo(newCacheFilename));
            });
    }));

    logSlugMsg(slug, `Start data cache generation (pid: ${process.pid})`);

    let startTime = Date.now();
    let planEventHandler;
    const data = await genData.fn(modelConfig, {
        createPlanEventHandler(getData) {
            if (typeof createPlanEventHandler === 'function') {
                return planEventHandler = createPlanEventHandler(pipeline(
                    getData,
                    writeCacheTask
                ));
            }
        }
    });

    return writeCacheTask(data, planEventHandler);
});
