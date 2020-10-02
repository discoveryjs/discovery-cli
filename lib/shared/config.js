const fs = require('fs');
const path = require('path');
const resolve = require('resolve');
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

function normalizeModelConfig(config) {
    config = config || {};

    const normalizedConfig = Object.assign({
        slug: config.slug,
        name: 'Untitled model',
        cache: undefined,
        cacheTtl: 0 // TTL check is disabled
    }, config);

    for (const prop of ['cacheTtl', 'cacheBgUpdate']) {
        if (typeof normalizedConfig[prop] === 'string') {
            normalizedConfig[prop] = parseDuration(normalizedConfig[prop]);
        }
    }

    return normalizedConfig;
}

function resolveModelConfig(value, basedir) {
    if (typeof value === 'string') {
        return require(path.resolve(basedir, value));
    }

    return value;
}

function resolvePlugin(value, basedir) {
    if (typeof value === 'string') {
        try {
            return resolve.sync(value, { basedir });
        } catch (e) {
            throw new Error('Plugin is not resolved: ' + value);
        }
    }
}

function normalize(config, options) {
    options = options || {};

    let { model, basedir, cachedir } = options;
    const cwd = process.env.PWD || process.cwd();
    let result;
    let models;

    if (cachedir === true) {
        cachedir = cwd;
    }

    // if no models treat it as single model configuration
    if (!config.models) {
        model = 'default';
        result = {
            name: 'Implicit config',
            cache: cachedir,
            mode: 'single',
            plugins: []
        };
        models = {
            default: config
        };
    } else {
        result = Object.assign({
            name: 'Discovery',
            cache: cachedir
        }, config, {
            mode: model ? 'single' : 'multi',
            plugins: Array.isArray(config.plugins) ? config.plugins : []
        });
        models = config.models;
    }

    result.download = 'download' in result ? Boolean(result.download) : true;
    result.favicon = result.favicon
        ? path.resolve(basedir, result.favicon)
        : path.join(discoveryDir, 'src/favicon.png');

    const getDownloadUrl = (mode, modelConfig, download) => {
        const downloadURL = '/gen/build.zip';
        return download
            ? mode === 'single'
                ? downloadURL
                : `/${modelConfig.slug}${downloadURL}`
            : false;
    };

    result.models = Object.keys(models).reduce((res, slug) => {
        if (!model || model === slug) {
            const modelConfig = normalizeModelConfig(
                Object.assign({ slug }, resolveModelConfig(models[slug], basedir))
            );

            modelConfig.download = getDownloadUrl(
                result.mode,
                modelConfig,
                'download' in modelConfig ? Boolean(modelConfig.download) : result.download
            );
            modelConfig.plugins = result.plugins
                .concat(modelConfig.plugins)
                .map(plugin => resolvePlugin(plugin, basedir))
                .filter(Boolean);

            switch (modelConfig.cache) {
                case true:
                    modelConfig.cache = cachedir || cwd;
                    break;

                case undefined:
                    modelConfig.cache = result.cache;
                    break;
            }

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

            config = Object.assign(
                { name: packageJson.name },
                config
            );
            break;

        default:
            // .discoveryrc.js
            // .discoveryrc.json
            // or any other
            config = require(configFilename);
    }

    return normalize(
        config,
        Object.assign({ basedir: path.dirname(configFilename) }, options)
    );
}

module.exports = {
    resolveConfigFilename,
    normalize,
    load
};
