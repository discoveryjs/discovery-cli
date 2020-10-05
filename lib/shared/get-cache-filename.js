const fs = require('fs');
const path = require('path');
const { getCacheFiles } = require('./utils');

module.exports = function getCacheFilename(modelConfig, newFile = false) {
    let { slug, cache } = modelConfig;
    let cacheFiles = [];
    let cacheFile;

    if (fs.existsSync(cache) && !newFile) {
        cacheFiles = getCacheFiles(cache)[slug] || [];

        if (cacheFiles.length) {
            cacheFile = cacheFiles[0].file;
        }
    }

    return cache
        ? path.join(cache, cacheFile || `.discoveryjs.${slug}.${Date.now()}.cache`)
        : undefined;
};
