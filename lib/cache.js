const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { stringifyStream } = require('@discoveryjs/json-ext');
const { getActualCache, genCacheFilename, genCacheInfo } = require('./shared/cache');
const { logSlugMsg } = require('./shared/utils');
const bootstrap = require('./shared/bootstrap');
const ensureDir = require('./shared/ensure-dir');
const genData = require('./data');

// modes
// - default – get cache or generate new one if not exists
// - readonly – get cache
// - force – generate cache (ignore existing)
module.exports = bootstrap.model(function getCache(modelConfig, { mode, pretty }) {
    const { slug } = modelConfig;
    const actualCache = mode !== 'force'
        ? getActualCache(modelConfig)
        : false;

    if (actualCache || mode === 'readonly') {
        return Promise.resolve(actualCache);
    }

    const newCacheFilename = genCacheFilename(modelConfig);
    const relNewCacheFilename = chalk.yellow(path.relative(process.cwd(), newCacheFilename));
    const tmpCacheFilename = path.join(os.tmpdir(), path.basename(newCacheFilename));
    let startTime = Date.now();

    logSlugMsg(slug, 'Start cache generation:', relNewCacheFilename);
    return genData.fn(modelConfig).then(data => new Promise((resolve, reject) => {
        logSlugMsg(slug, 'Cache data ready in', Date.now() - startTime, 'ms:', relNewCacheFilename);

        const startWriteTime = Date.now();
        stringifyStream(data, null, pretty)
            .on('error', reject)
            .pipe(fs.createWriteStream(tmpCacheFilename))
            .on('error', reject)
            .on('finish', () => {
                fs.renameSync(tmpCacheFilename, ensureDir(newCacheFilename));
                logSlugMsg(slug, 'Cache written in', Date.now() - startWriteTime, 'ms:', relNewCacheFilename);

                resolve(genCacheInfo(slug, newCacheFilename));
            });
    }));
});
