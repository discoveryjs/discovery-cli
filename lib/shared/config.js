const fs = require('fs');
const path = require('path');
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
    let {
        basedir: viewBasedir,
        assets
    } = viewConfig || {};

    // basedir
    viewBasedir = path.resolve(basedir, viewBasedir || '');

    // assets
    assets = (Array.isArray(assets) ? assets : [])
        .map(filename => resolveFilename(filename, viewBasedir));

    return {
        ...stripKeys(viewConfig || {}, ['basedir']),
        assets
    };
}

function normalizeModelConfig(modelConfig, basedir) {
    let {
        basedir: modelBasedir,
        data,
        prepare,
        view,
        routers,
        cacheTtl,
        cacheBgUpdate
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

    // cacheTtl
    cacheTtl = typeof cacheTtl === 'string'
        ? parseDuration(cacheTtl)
        : cacheTtl || 0; // 0 – TTL check is disabled

    // cacheBgUpdate
    if (typeof cacheBgUpdate === 'string') {
        cacheBgUpdate = parseDuration(cacheBgUpdate);
    }

    return {
        name: 'Untitled model',
        cache: undefined,
        ...modelConfig,
        data,
        prepare,
        view,
        routers,
        cacheTtl,
        cacheBgUpdate
    };
}

function resolveModelConfig(value, basedir) {
    if (typeof value === 'string') {
        const filepath = resolveFilename(value, basedir);

        return [require(filepath), path.dirname(filepath)];
    }

    return [value, basedir];
}

function getDownloadUrl(mode, modelConfig, download) {
    const downloadURL = '/gen/build.zip';

    return download
        ? mode === 'single'
            ? downloadURL
            : `/${modelConfig.slug}${downloadURL}`
        : false;
}

function normalizeConfig(config, options, basedir) {
    config = config || {};
    options = options || {};

    let { model } = options;
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

    result.darkmode = 'darkmode' in result ? result.darkmode : 'auto';
    result.download = 'download' in result ? Boolean(result.download) : true;
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
            const modelConfig = {
                slug, // for a position
                ...modelBaseConfig,
                ...normalizeModelConfig(...resolveModelConfig(result.models[slug], configBasedir)),
                slug  // for a value
            };

            if (modelConfig.view.libs) {
                console.error(`[${slug}] modelConfig.view.libs is not supported anymore, use require() or ES6 import expressions instead`);
            }

            if (modelConfig.extendRouter) {
                console.error(`[${slug}] modelConfig.extendRouter is not supported anymore, use modelConfig.routes instead`);
            }

            modelConfig.darkmode = 'darkmode' in modelConfig
                ? modelConfig.darkmode
                : result.darkmode;

            modelConfig.download = getDownloadUrl(
                result.mode,
                modelConfig,
                'download' in modelConfig ? Boolean(modelConfig.download) : result.download
            );

            modelConfig.routers = [
                ...modelBaseConfig.routers,
                ...modelConfig.routers
            ];

            modelConfig.view.assets = [
                ...modelBaseConfig.view.assets,
                ...modelConfig.view.assets
            ];

            modelConfig.cache = Boolean(modelConfig.cache);

            res.push(modelConfig);
        }

        return res;
    }, []);

    return result;
}

function loadConfig(filename, options) {
    let configFilename = resolveConfigFilename(filename);
    let config;

    if (!configFilename) {
        return normalizeConfig({}, options);
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

    return normalizeConfig(config, options, path.dirname(configFilename));
}

module.exports = {
    resolveConfigFilename,
    normalizeViewConfig,
    normalizeModelConfig,
    normalizeConfig,
    loadConfig
};
