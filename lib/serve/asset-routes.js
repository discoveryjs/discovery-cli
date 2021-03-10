const fs = require('fs');
const path = require('path');
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

        logMsg('Сonfig change detected, reload config...');

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

module.exports = function addAssetRouters(router, name, config, options, modelConfig, cacheDispatcher) {
    let currentBundles = new Map();
    const getAsset = async (type) => {
        const filename = (modelConfig ? modelConfig.slug + '/' : '') +
            type.replace(/\[name\]/g, modelConfig ? 'model' : 'index').replace(/\.map$/, '');
        let currentBundle = currentBundles.get(filename);

        if (!currentBundle || !/\.map$/.test(type)) {
            currentBundle = makeBundle(alwaysFreshConfig(config, options), options, {
                outdir: '/',
                // FIXME: Disable incremental build for now, since it's as twice as slower
                // incremental: true,
                sourcemap: true
            }, {
                cacheDispatcher,
                filter: entrypoint => entrypoint === filename
            });

            currentBundles.set(filename, currentBundle);
        }

        const { outputFiles } = await currentBundle;

        return outputFiles.find(file => file.path.endsWith('/' + path.basename(filename))).text;
    };

    router.get(`/${name}.js`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/javascript', getAsset('[name].js'))
    );
    router.get(`/${name}.js.map`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/json', getAsset('[name].js.map'))
    );
    router.get(`/${name}.css`, (_, res, next) =>
        responseBundleAsset(res, next, 'text/css', getAsset('[name].css'))
    );
    router.get(`/${name}-loader.js`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/javascript', getAsset('[name]-loader.js'))
    );
    router.get(`/${name}-loader.js.map`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/json', getAsset('[name]-loader.js.map'))
    );
    router.get(`/${name}-loader.css`, (_, res, next) =>
        responseBundleAsset(res, next, 'text/css', getAsset('[name]-loader.css'))
    );

    // FIXME: esbuild generates source map file as index.js.map and referenced to it in JS;
    // make redirect as workaround until we can change output filenames
    if (modelConfig && name !== 'index') {
        router.get(`/${modelConfig.slug}.js.map`, (_, res) => res.redirect(301, `${name}.js.map`));
        router.get(`/${modelConfig.slug}-loader.js.map`, (_, res) => res.redirect(301, `${name}-loader.js.map`));
    }

    if (modelConfig && modelConfig.view && modelConfig.view.bundles) {
        for (const relpath of Object.keys(modelConfig.view.bundles)) {
            switch (path.extname(relpath)) {
                case '.js':
                    router.get(`/${relpath}`, (_, res, next) =>
                        responseBundleAsset(res, next, 'application/javascript', getAsset(relpath))
                    );
                    router.get(`/${relpath}.map`, (_, res, next) =>
                        responseBundleAsset(res, next, 'application/json', getAsset(relpath + '.map'))
                    );
                    break;

                case '.css':
                    router.get(`/${relpath}`, (_, res, next) =>
                        responseBundleAsset(res, next, 'text/css', getAsset(relpath))
                    );
                    break;
            }
        }
    }
};
