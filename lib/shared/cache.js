const fs = require('fs');
const path = require('path');
const matchCacheFilename = /(?:^|\/)\.discoveryjs\.(.*?)\.(\d+)\.cache$/;

function genCacheFilename(modelConfig) {
    const { slug, cache } = modelConfig;
    const dict = new Map([
        ['slug', slug],
        ['timestamp', Date.now()]
    ]);

    return cache && cache.replace(/\[(\S+)\]/g, (m, key) => dict.has(key) ? dict.get(key) : m);
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

module.exports = {
    genCacheFilename,
    genCacheInfo,
    getActualCache,
    getCaches
};
