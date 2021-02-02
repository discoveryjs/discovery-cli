const fs = require('fs');
const path = require('path');
const discoveryDir = require('./discovery-dir');
const { parseDuration } = require('./utils');

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

function normalizeModelConfig(config, basedir) {
    let { data, view, routers, cacheTtl, cacheBgUpdate } = config || {};

    // routers
    routers = Array.isArray(routers)
        ? routers.map(filename => path.resolve(basedir, filename))
        : [];

    // data
    if (typeof data === 'string') {
        data = path.resolve(basedir, data);
    }

    // view
    view = { ...view };
    view.basedir = path.resolve(basedir, view.basedir || '');
    view.assets = (Array.isArray(view.assets) ? view.assets : [])
        .map(p => path.resolve(view.basedir, p));

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
        ...config,
        data,
        view,
        routers,
        cacheTtl,
        cacheBgUpdate
    };
}

function resolveModelConfig(value, basedir) {
    if (typeof value === 'string') {
        const filepath = path.resolve(basedir, value);

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

function normalize(config, options) {
    options = options || {};

    let { model, basedir, cachedir, cache } = options;
    const cwd = process.env.PWD || process.cwd();
    let modelBaseConfig = normalizeModelConfig(config.modelBaseConfig || {}, basedir);
    let result;
    let models;

    cachedir = cache !== false && typeof cachedir === 'string'
        ? path.resolve(cwd, cachedir)
        : false;

    // if no models treat it as single model configuration
    if (!config.models) {
        model = 'default';
        result = {
            name: 'Implicit config',
            cache: cachedir,
            mode: 'single'
        };
        models = {
            default: config
        };
    } else {
        result = {
            name: 'Discovery',
            cache: cachedir,
            ...config,
            mode: model ? 'single' : 'multi'
        };
        models = config.models;
    }

    result.darkmode = 'darkmode' in result ? result.darkmode : 'auto';
    result.download = 'download' in result ? Boolean(result.download) : true;
    result.view = normalizeModelConfig(result, basedir).view;
    result.favicon = result.favicon
        ? path.resolve(basedir, result.favicon)
        : path.join(discoveryDir, 'src/favicon.png');

    if (result.extendRouter) {
        console.error('config.extendRouter is not supported anymore, use config.routes instead');
    }

    result.routers = Array.isArray(result.routers)
        ? result.routers.map(filename => path.resolve(basedir, filename))
        : [];

    result.models = Object.keys(models).reduce((res, slug) => {
        if (!model || model === slug) {
            const modelConfig = {
                slug, // for a position
                ...modelBaseConfig,
                ...normalizeModelConfig(...resolveModelConfig(models[slug], basedir)),
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

            modelConfig.cache = modelConfig.cache && cachedir
                ? path.join(cachedir, '.discoveryjs.[slug].[timestamp].[hash].cache')
                : false;

            res.push(modelConfig);
        }

        return res;
    }, []);

    return result;
}

function load(filename, options) {
    let configFilename = resolveConfigFilename(filename);
    let config;

    if (!configFilename) {
        return normalize({}, options);
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

    return normalize(config, {
        basedir: path.dirname(configFilename),
        ...options
    });
}

module.exports = {
    resolveConfigFilename,
    normalize,
    load
};
