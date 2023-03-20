const fs = require('fs');
const path = require('path');
const mime = require('mime');
const makeBundle = require('../shared/bundle');
const configUtils = require('../shared/config');
const { logMsg, logError } = require('../shared/utils');
const refreshConfigMap = new WeakMap();

function alwaysFreshConfig(config, options) {
    if (!refreshConfigMap.has(config)) {
        refreshConfigMap.set(config, {
            requireCacheDigest: Object.create(null),
            lastRequireCacheCheck: 0,
            config
        });
    }

    const cfg = refreshConfigMap.get(config);
    const newDigest = Object.create(null);
    let changed = false;

    // don't check if last check was less than 1 second ago
    if (Date.now() - cfg.lastRequireCacheCheck < 1000) {
        return cfg.config;
    }

    // avoid update on first check
    if (cfg.lastRequireCacheCheck === 0) {
        cfg.requireCacheDigest = newDigest;
    }

    // check modules in cache is changed
    for (const ref of [...new Set([...Object.keys(require.cache), ...Object.keys(cfg.requireCacheDigest)])]) {
        const { mtime } = fs.statSync(ref);

        newDigest[ref] = Number(mtime);
        if (cfg.requireCacheDigest[ref] !== Number(mtime)) {
            changed = true;
        }
    }

    cfg.lastRequireCacheCheck = Date.now();

    if (changed) {
        // drop require cache
        for (const ref of Object.keys(require.cache)) {
            delete require.cache[ref];
        }

        logMsg('Config change detected, reload config...');

        // load fresh config and update configuration
        try {
            cfg.config = configUtils.loadConfigWithFallback(options).config;
            cfg.requireCacheDigest = newDigest;
        } catch (e) {
            logError('Config load failed', e);
            throw e;
        }
    }

    // fresh config or the same if nothing changed
    return cfg.config;
}

async function responseBundleAsset(res, next, type, content) {
    try {
        const resContent = await content;

        res.set('Content-Type', type);
        res.send(resContent);
    } catch (e) {
        next(e);
    }
}

module.exports = function addAssetRoutes(router, name, config, options, modelConfig, cacheDispatcher) {
    let currentBundles = new Map();
    const getAsset = async (type) => {
        const filename = (modelConfig ? modelConfig.slug + '/' : '') +
            type.replace(/\[name\]/g, modelConfig ? 'model' : 'index');
        const fileRef = filename.replace(/\.map$/, '');
        let currentBundle = currentBundles.get(fileRef);

        if (!currentBundle || !/\.map$/.test(type)) {
            currentBundle = makeBundle(alwaysFreshConfig(config, options), { ...options, serveOnlyAssets: true }, {
                outdir: '/',
                // FIXME: Disable incremental build for now, since it's as twice as slower
                // incremental: true,
                minify: typeof options.minify === 'boolean' ? options.minify : true,
                sourcemap: true
            }, {
                cacheDispatcher,
                filter: entrypoint => entrypoint === fileRef
            });

            currentBundles.set(fileRef, currentBundle);
        }

        const { outputFiles } = await currentBundle;
        const outputFile = outputFiles.find(file =>
            path.basename(file.path) === path.basename(filename)
        );

        return outputFile.text;
    };

    const addAssetRoute = (filepath, assetpath = filepath) => {
        router.get(`/${filepath}`, (_, res, next) =>
            responseBundleAsset(res, next, mime.getType(path.extname(filepath)), getAsset(assetpath))
        );
        router.get(`/${filepath}.map`, (_, res, next) =>
            responseBundleAsset(res, next, 'application/json', getAsset(assetpath + '.map'))
        );
    };

    addAssetRoute(`${name}.js`, '[name].js');
    addAssetRoute(`${name}.css`, '[name].css');
    addAssetRoute(`${name}-loader.js`, '[name]-loader.js');
    addAssetRoute(`${name}-loader.css`, '[name]-loader.css');

    if (modelConfig && modelConfig.view && modelConfig.view.bundles) {
        for (const relpath of Object.keys(modelConfig.view.bundles)) {
            switch (path.extname(relpath)) {
                case '.js':
                case '.css':
                    addAssetRoute(relpath);
                    break;
            }
        }
    }
};
