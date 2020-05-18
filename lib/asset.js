const path = require('path');
const fs = require('fs');
const bootstrap = require('./shared/bootstrap');
const types = {
    'prepare': (assetConfig, baseURI) => wrapInEsModule(
        assetConfig,
        baseURI,
        getPrepare(assetConfig)
    ),
    'js': (assetConfig, baseURI) => wrapInEsModule(
        assetConfig,
        baseURI,
        getAssetList(assetConfig, baseURI, '.js')
            .map(filepath =>
                `\n!(function(module, exports){\n${
                    fetchFileContent(filepath)
                }\n}).call(this);\n`
            ).join('')
    ),
    'css': (assetConfig, baseURI) =>
        concatCssFiles(getAssetList(assetConfig, baseURI, '.css')),
    'libs-js': (assetConfig, baseURI, options) =>
        toJsLib(getLibsList(assetConfig, baseURI, '.js'), options.es5LibsJs),
    'libs-css': (assetConfig, baseURI) =>
        toCSSLib(getLibsList(assetConfig, baseURI, '.css'))
};

types['index-js'] = types.js;
types['index-css'] = types.css;
types['index-libs-js'] = types['libs-js'];
types['index-libs-css'] = types['libs-css'];

function fetchFileContent(filepath) {
    if (!fs.existsSync(filepath)) {
        console.error('[discovery-cli/asset] File `' + filepath + '` defined in `config` is not found');
        return '';
    }

    let content = fs.readFileSync(filepath, 'utf8');

    // strip off references to source maps to avoid warnings
    content = content.replace(/\/\/# sourceMappingURL=.+\s*$/, '');

    return content;
}

function normFileList(list, baseURI, ext) {
    if (!Array.isArray(list)) {
        return [];
    }

    return list
        .filter(filepath => path.extname(filepath) === ext)
        .map(filepath => path.resolve(baseURI, filepath));
}

function wrapInEsModule(assetConfig, baseURI, code) {
    const libs = getLibsList(assetConfig, baseURI, '.js');
    const libsImport = libs.length
        ? [`import { ${libs.map(({ name }) => name).join(', ')} } from './${assetConfig.models ? 'index' : 'model'}-libs.js';`, '']
        : [];

    return libsImport.concat(
        'export default function(discovery) {',
        code || '/* javascript assets are not defined in a asset config */',
        '}'
    ).join('\n');
}

function umdModuleIife(code) {
    return [
        '(function(){',
        'var exports = {};',
        'var module = { exports: exports };',
        code,
        'return module.exports;',
        '}).call(this)'
    ].join('\n');
}

function getPrepare(assetConfig) {
    const { slug, prepare } = assetConfig;

    if (!prepare) {
        return '/* prepare code is not defined in a model config */';
    }

    if (typeof prepare !== 'string') {
        throw new Error(`Error in \`${slug}\` model: prepare option should be a string or undefined`);
    }

    return fetchFileContent(prepare);
}

function getAssetList(assetConfig, baseURI, ext) {
    const view = assetConfig.view || {};
    return normFileList(view.assets, baseURI, ext);
}

function getLibsList(assetConfig, baseURI, ext) {
    const view = assetConfig.view || {};
    const libs = {
        ...view.libs
    };

    if (!assetConfig.models) {
        libs.plugins = {
            files: assetConfig.plugins,
            prepareContent: files => 'module.exports = [' +
                files
                    .map(fetchFileContent)
                    .map(umdModuleIife)
                    .join(',\n') +
            ']'
        };
    }

    return Object.keys(libs).map(name => {
        let libConfig = libs[name];

        if (typeof libConfig === 'string') {
            libConfig = [libConfig];
        }

        if (Array.isArray(libConfig)) {
            libConfig = {
                files: libConfig
            };
        }

        return {
            name: libConfig.name ? String(libConfig.name) : name,
            files: normFileList(libConfig.files, baseURI, ext),
            prepareContent: libConfig.prepareContent
        };
    }).filter(config => config.files.length || config.prepareContent);
}

function concatContent(files) {
    return files.map(filepath => fetchFileContent(filepath)).join('');
}

function toJsLib(libs, es5) {
    return [
        es5 ? 'Object.defineProperty(exports, "__esModule", { value: true });' : '',
        ...libs.reduce((lines, { name, files, prepareContent = concatContent }) =>
            lines.concat(
                '',
                `${es5 ? `const ${name} = exports.` : 'export const ' }${name} = ${
                    umdModuleIife(prepareContent(files))
                };`
            ), []
        )
    ].join('\n');
}

async function inlineCss(filename) {
    const bundleCss = require('./shared/bundle-css');

    try {
        return (await bundleCss(filename)).content;
    } catch (e) {
        console.error(`[discovery-cli/asset] Bundle ${filename} error:`, e);
        return `/* Bundle ${filename} error ${e.message} */`;
    }
}

function concatCssFiles(files) {
    return Promise.all(files.map(inlineCss))
        .then(res => res.join(''));
}

function toCSSLib(libs) {
    return concatCssFiles([].concat(...libs.map(({ files }) => files)));
}

module.exports = bootstrap(function(options, config) {
    const { modelName, type } = options;
    const hasModels = Array.isArray(config.models) && config.models.length > 0;
    const indexAssets = hasModels && typeof type === 'string' && type.indexOf('index-') === 0;
    let assetConfig = null;

    if (!type) {
        console.error('[discovery-cli/asset] Asset type is not specified. Use `--type` option to specify a type');
    }

    if (!types.hasOwnProperty(type)) {
        console.error('[discovery-cli/asset] Wrong asset type: ' + type);
        process.exit(2);
    }

    if (hasModels) {
        if (indexAssets) {
            assetConfig = {
                ...config,
                plugins: undefined // ignore plugins
            };
        } else {
            if (!modelName) {
                console.error('[discovery-cli/asset] Model name is not specified. Use `--model` option to specify a model');
                process.exit(2);
            }

            assetConfig = config.models.find(model => model.slug === modelName);

            if (!assetConfig) {
                console.error(
                    'Model `' + modelName + '` is not found in config. ' +
                    'Available models: ' +
                        (config.models.length ? config.models.map(model => model.slug).join(', ') : '<no model is available>')
                );
                process.exit(2);
            }
        }
    }

    const view = assetConfig.view || {};
    const baseURI = view.basedir || view.base || '';

    return Promise.resolve(types[type](assetConfig, baseURI, options));
});
