const fs = require('fs');
const path = require('path');
const cron = require('cron-validator');
const discoveryDir = require('./discovery-dir');
const { parseDuration } = require('./utils');

function stripKeys(obj, stripKeys) {
    const result = {};

    for (const key of Object.keys(obj)) {
        if (!stripKeys.includes(key)) {
            result[key] = obj[key];
        }
    }

    return result;
}

function unique(arr) {
    return [...new Set(arr)];
}

function resolveFilename(filepath, basedir) {
    return require.resolve(path.resolve(basedir, filepath));
}

function resolveConfigFilename(filename) {
    const cwd = process.env.PWD || process.cwd();

    if (filename) {
        filename = path.resolve(cwd, filename);
    } else {
        const autoFilenames = [
            path.join(cwd, '.discoveryrc.js'),
            path.join(cwd, '.discoveryrc.json'),
            path.join(cwd, '.discoveryrc'),
            path.join(cwd, 'package.json')
        ];

        for (let candidate of autoFilenames) {
            if (fs.existsSync(candidate)) {
                filename = candidate;
                break;
            }
        }

        if (filename && path.basename(filename) === 'package.json') {
            try {
                if ('discovery' in require(filename) === false) {
                    filename = undefined;
                }
            } catch (e) {
                filename = undefined;
            }
        }
    }

    return filename;
}

function normalizeViewConfig(viewConfig, basedir) {
    const warnings = [];
    let {
        basedir: viewBasedir,
        libs,
        inspector,
        router,
        serveOnlyAssets,
        assets,
        bundles
    } = viewConfig || {};

    // basedir
    viewBasedir = path.resolve(basedir, viewBasedir || '');

    // inspector (enabled by default)
    inspector = inspector === undefined || Boolean(inspector);

    // default router (enabled by default)
    router = router === undefined || Boolean(router);

    // assets
    serveOnlyAssets = (Array.isArray(serveOnlyAssets) ? serveOnlyAssets : [])
        .map(filename => resolveFilename(filename, viewBasedir));
    assets = (Array.isArray(assets) ? assets : [])
        .map(filename => resolveFilename(filename, viewBasedir));

    // bundles
    bundles = bundles
        ? Object.fromEntries(Object.entries(bundles).map(([relpath, filename]) => [
            path.posix.resolve('/', relpath).slice(1),
            resolveFilename(filename, viewBasedir)
        ]))
        : null;

    // validation
    if (libs) {
        warnings.push('modelConfig.view.libs is not supported anymore, use require() or ES6 import expressions instead');
    }

    return {
        ...stripKeys(viewConfig || {}, ['basedir']),
        inspector,
        router,
        serveOnlyAssets,
        assets,
        bundles,
        warnings
    };
}

function normalizeModelConfig(modelConfig, basedir) {
    const warnings = [];
    let {
        basedir: modelBasedir,
        routers,
        extendRouter,
        data,
        prepare,
        view,
        cache,
        cacheTtl = 0, // 0 – TTL check is disabled
        cacheBgUpdate = false
    } = modelConfig || {};

    // basedir
    modelBasedir = path.resolve(basedir, modelBasedir || '');

    // routers
    routers = Array.isArray(routers)
        ? routers.map(filename => resolveFilename(filename, modelBasedir))
        : [];

    // data
    if (typeof data === 'string') {
        data = resolveFilename(data, modelBasedir);
    }

    // prepare
    if (typeof prepare === 'string') {
        prepare = resolveFilename(prepare, modelBasedir);
    }

    // view
    view = normalizeViewConfig(view, modelBasedir);

    // cache
    cache = Boolean(cache);

    // cacheTtl
    if (typeof cacheTtl === 'string') {
        const duration = parseDuration(cacheTtl);

        if (duration !== null) {
            cacheTtl = duration;
        } else if (!cron.isValidCron(cacheTtl)) {
            warnings.push(`Bad cron expression in modelConfig.cacheTtl: "${cacheTtl}"`);
            cacheTtl = 0;
        }
    } else if (!isFinite(cacheTtl) || !Number.isInteger(cacheTtl) || cacheTtl < 0) {
        warnings.push(`Bad duration value in modelConfig.cacheTtl: "${cacheTtl}"`);
        cacheTtl = 0;
    }

    // cacheBgUpdate
    if (typeof cacheBgUpdate !== 'boolean' && cacheBgUpdate !== 'only') {
        warnings.push(`Bad value for modelConfig.cacheBgUpdate (should be boolean or "only"): ${cacheBgUpdate}`);
        cacheBgUpdate = false;
    }

    // validation
    if (extendRouter) {
        warnings.push('modelConfig.extendRouter is not supported anymore, use modelConfig.routes instead');
    }

    if (cacheBgUpdate && !cacheTtl) {
        warnings.push('modelConfig.cacheBgUpdate is enabled, but modelConfig.cacheTtl is not set (cacheBgUpdate setting is ignored)');
        cacheBgUpdate = false;
    }

    return {
        name: 'Untitled model',
        cache: undefined,
        ...stripKeys(modelConfig || {}, ['slug', 'basedir']),
        data,
        prepare,
        view,
        routers,
        cache,
        cacheTtl,
        cacheBgUpdate,
        warnings
    };
}

function resolveModelConfig(value, basedir) {
    if (typeof value === 'string') {
        const filepath = resolveFilename(value, basedir);

        return [require(filepath), path.dirname(filepath)];
    }

    return [value, basedir];
}

function getDownloadUrl(download) {
    return download ? 'build.zip' : false;
}

function normalizeConfig(config, model, basedir) {
    config = config || {};

    const cwd = process.env.PWD || process.cwd();
    const configBasedir = config.basedir ? path.resolve(basedir || cwd, config.basedir) : basedir || cwd;
    let modelBaseConfig = normalizeModelConfig(config.modelBaseConfig || {}, configBasedir);
    let result;

    // if no models treat it as single model configuration
    if (!config.models) {
        model = 'default';
        result = {
            name: 'Implicit config',
            mode: 'single',
            models: {
                default: config
            }
        };
    } else {
        result = {
            name: 'Discovery',
            mode: model ? 'single' : 'multi',
            ...stripKeys(config, ['mode'])
        };
    }

    result.darkmode = result.darkmode !== undefined ? result.darkmode : 'auto';
    result.download = result.download !== undefined ? Boolean(result.download) : true;
    result.upload = result.upload !== undefined ? result.upload : false;
    result.embed = result.embed !== undefined ? Boolean(result.embed) : false;
    result.view = normalizeViewConfig(result.view, configBasedir);
    result.favicon = result.favicon
        ? path.resolve(configBasedir, result.favicon)
        : path.join(discoveryDir, 'src/favicon.png');

    if (result.extendRouter) {
        console.error('config.extendRouter is not supported anymore, use config.routes instead');
    }

    result.routers = Array.isArray(result.routers)
        ? result.routers.map(filename => path.resolve(configBasedir, filename))
        : [];

    result.models = Object.keys(result.models).reduce((res, slug) => {
        if (!model || model === slug) {
            const [resolvedConfig, modelBasedir] = resolveModelConfig(result.models[slug], configBasedir);
            const modelConfig = {
                slug,
                ...normalizeModelConfig({
                    ...stripKeys(modelBaseConfig, 'prepare'),
                    ...resolvedConfig
                }, modelBasedir)
            };

            if (modelBaseConfig.prepare) {
                modelConfig.commonPrepare = modelBaseConfig.prepare;
            }

            modelConfig.darkmode = modelConfig.darkmode !== undefined
                ? modelConfig.darkmode
                : result.darkmode;

            modelConfig.download = getDownloadUrl(
                modelConfig.download !== undefined
                    ? Boolean(modelConfig.download)
                    : result.download
            );

            modelConfig.upload = modelConfig.upload !== undefined
                ? modelConfig.upload
                : result.upload;

            modelConfig.embed = modelConfig.embed !== undefined
                ? Boolean(modelConfig.embed)
                : result.embed;

            modelConfig.routers = unique([
                ...modelBaseConfig.routers,
                ...modelConfig.routers
            ]);

            modelConfig.view.serveOnlyAssets = unique([
                ...modelBaseConfig.view.serveOnlyAssets,
                ...modelConfig.view.serveOnlyAssets
            ]);

            modelConfig.view.assets = unique([
                ...modelBaseConfig.view.assets,
                ...modelConfig.view.assets
            ]);

            res.push(modelConfig);
        }

        return res;
    }, []);

    return result;
}

function loadConfig(filename, model) {
    let configFilename = resolveConfigFilename(filename);
    let config;

    if (!configFilename) {
        return normalizeConfig({}, model);
    }

    if (!fs.existsSync(configFilename)) {
        throw new Error('Config file is not found: ' + filename);
    }

    switch (path.basename(configFilename)) {
        case '.discoveryrc':
            config = JSON.parse(fs.readFileSync(configFilename, 'utf8'));
            break;

        case 'package.json':
            const packageJson = require(configFilename);
            config = packageJson.discovery;

            if (typeof packageJson.discovery === 'string') {
                configFilename = path.resolve(path.dirname(configFilename), packageJson.discovery);
                config = require(configFilename);
            } else {
                config = packageJson.discovery;
            }

            config = {
                name: packageJson.name,
                ...config
            };
            break;

        default:
            // .discoveryrc.js
            // .discoveryrc.json
            // or any other
            config = require(configFilename);
    }

    return normalizeConfig(config, model, path.dirname(configFilename));
}

function loadConfigWithFallback({ configFile, model } = {}) {
    const resolvedConfigFile = resolveConfigFilename(configFile);
    const config = resolvedConfigFile
        ? loadConfig(resolvedConfigFile, model)
        : {
            ...normalizeConfig({
                upload: true,
                meta: {
                    description: [
                        'Running in `model free mode` since no config or model is set. However, you can load the JSON file, analyse it, and create your own report.',
                        '',
                        'See [documention](https://github.com/discoveryjs/discovery/blob/master/README.md) for details.'
                    ]
                }
            }),
            name: 'Discovery',
            mode: 'modelfree'
        };

    return {
        configFile: resolvedConfigFile,
        config
    };
}

module.exports = {
    resolveConfigFilename,
    normalizeViewConfig,
    normalizeModelConfig,
    normalizeConfig,
    loadConfig,
    loadConfigWithFallback
};
