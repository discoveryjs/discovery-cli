const path = require('path');
const makeBundle = require('../shared/bundle');

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
        const filename = (modelConfig ? modelConfig.slug : 'index') + type.replace(/\.map$/, '');
        let currentBundle = currentBundles.get(filename);

        if (!currentBundle || !/\.map$/.test(type)) {
            currentBundle = makeBundle(config, options, {
                outdir: '/',
                // FIXME: Disable incremental build for now, since it's as twice as slower
                // incremental: true,
                sourcemap: true
            }, {
                cacheDispatcher,
                filter: entrypoint => path.basename(entrypoint) === filename
            });

            currentBundles.set(filename, currentBundle);
        }

        const { outputFiles } = await currentBundle;

        return outputFiles.find(file => file.path.endsWith(type)).text;
    };

    router.get(`/${name}.js`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/javascript', getAsset('.js'))
    );
    router.get(`/${name}.js.map`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/json', getAsset('.js.map'))
    );
    router.get(`/${name}-loader.js`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/javascript', getAsset('-loader.js'))
    );
    router.get(`/${name}-loader.js.map`, (_, res, next) =>
        responseBundleAsset(res, next, 'application/json', getAsset('-loader.js.map'))
    );
    router.get(`/${name}.css`, (_, res, next) =>
        responseBundleAsset(res, next, 'text/css', getAsset('.css'))
    );

    // FIXME: esbuild generates source map file as index.js.map and referenced to it in JS;
    // make redirect as workaround until we can change output filenames
    if (modelConfig && name !== 'index') {
        router.get(`/${modelConfig.slug}.js.map`, (_, res) => res.redirect(301, `${name}.js.map`));
        router.get(`/${modelConfig.slug}-loader.js.map`, (_, res) => res.redirect(301, `${name}-loader.js.map`));
    }
};
