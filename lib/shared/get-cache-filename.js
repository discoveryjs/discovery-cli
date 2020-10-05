const fs = require('fs');
const path = require('path');

function getCacheFilename(modelConfig, newFile = false) {
    let { slug, cache } = modelConfig;
    let cacheFiles = [];
    let cacheFile;

    if (fs.existsSync(cache) && !newFile) {
        cacheFiles = getCacheFiles(cache)[slug] || [];

        if (cacheFiles.length) {
            cacheFile = cacheFiles[0].file;
        }
    }

    return slug && cache
        ? path.join(cache, cacheFile || `.discoveryjs.${slug}.${Date.now()}.cache`)
        : undefined;
};

function getCacheFiles(cacheDir) {
    if (!fs.existsSync(cacheDir)) {
        return {};
    }

    const cacheFilesBySlugs = fs.readdirSync(cacheDir).reduce((res, file) => {
        const [, slug, timestamp] = file.match(/^\.discoveryjs\.(.*?)\.(\d+)\.cache$/) || [];

        if (slug && timestamp) {
            res[slug] = res[slug] || [];
            res[slug].push({
                file,
                slug,
                timestamp
            });
        }

        return res;
    }, []);


    for (const caches of Object.values(cacheFilesBySlugs)) {
        caches.sort((a, b) => b.timestamp - a.timestamp);
    }

    return cacheFilesBySlugs;
}

module.exports = {
    getCacheFilename,
    getCacheFiles
};
