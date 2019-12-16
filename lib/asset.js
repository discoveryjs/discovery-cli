const path = require('path');
const fs = require('fs');
const bootstrap = require('./shared/bootstrap');
const types = {
    'prepare': (modelConfig, baseURI) => wrapInEsModule(
        modelConfig,
        baseURI,
        getPrepare(modelConfig)
    ),
    'js': (modelConfig, baseURI) => wrapInEsModule(
        modelConfig,
        baseURI,
        getAssetList(modelConfig, baseURI, '.js')
            .map(filepath =>
                `\n!(function(module, exports){\n${
                    fetchFileContent(filepath)
                }\n}).call(this);\n`
            ).join('')
    ),
    'css': (modelConfig, baseURI) =>
        concatContent(getAssetList(modelConfig, baseURI, '.css')),
    'libs-js': (modelConfig, baseURI, options) =>
        toJsLib(getLibsList(modelConfig, baseURI, '.js'), options.es5LibsJs),
    'libs-css': (modelConfig, baseURI) =>
        toCSSLib(getLibsList(modelConfig, baseURI, '.css'))
};

function fetchFileContent(filepath) {
    if (!fs.existsSync(filepath)) {
        console.error('File `' + filepath + '` defined in `config` is not found');
        return '';
    }

    return fs.readFileSync(filepath, 'utf8');
}

function normFileList(list, baseURI, ext) {
    if (!Array.isArray(list)) {
        return [];
    }

    return list
        .filter(filepath => path.extname(filepath) === ext)
        .map(filepath => path.resolve(baseURI, filepath));
}

function wrapInEsModule(modelConfig, baseURI, code) {
    const libs = getLibsList(modelConfig, baseURI, '.js');
    const libsImport = libs.length
        ? [`import { ${libs.map(({ name }) => name).join(', ')} } from './model-libs.js';`, '']
        : [];

    return libsImport.concat(
        'export default function(discovery) {',
        code || '/* javascript assets are not defined in a model config */',
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

function getPrepare(modelConfig) {
    const { slug, prepare } = modelConfig;

    if (!prepare) {
        return '/* prepare code is not defined in a model config */';
    }

    if (typeof prepare !== 'string') {
        throw new Error(`Error in \`${slug}\` model: prepare option should be a string or undefined`);
    }

    return fetchFileContent(prepare);
}

function getAssetList(modelConfig, baseURI, ext) {
    const view = modelConfig.view || {};
    return normFileList(view.assets, baseURI, ext);
}

function getLibsList(modelConfig, baseURI, ext) {
    const view = modelConfig.view || {};
    const libs = {
        ...view.libs,
        plugins: {
            files: modelConfig.plugins,
            prepareContent: files => 'module.exports = [' +
                files
                    .map(fetchFileContent)
                    .map(umdModuleIife)
                    .join(',\n') +
            ']'
        }
    };

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
                `${es5 ? 'exports.' : 'export const ' }${name} = ${
                    umdModuleIife(prepareContent(files))
                };`
            ), []
        )
    ].join('\n');
}

function toCSSLib(libs) {
    return libs.map(({ files }) => concatContent(files)).join('');
}


module.exports = bootstrap(function(options, config) {
    const hasModels = Array.isArray(config.models) && config.models.length > 0;
    const { modelName, type } = options;

    if (hasModels && !modelName) {
        console.error('Model name is not specified. Use `--model` option to specify a model');
        process.exit(2);
    }

    if (!type) {
        console.error('Asset type is not specified. Use `--type` option to specify a type');
    }

    if (!types.hasOwnProperty(type)) {
        console.error('Wrong asset type: ' + type);
        process.exit(2);
    }

    let modelConfig = hasModels
        ? config.models.find(model => model.slug === modelName)
        : {};

    if (hasModels && !modelConfig) {
        console.error(
            'Model `' + modelName + '` is not found in config. ' +
            'Available models: ' +
                (config.models.length ? config.models.map(model => model.slug).join(', ') : '<no model is available>')
        );
        process.exit(2);
    }

    const view = modelConfig.view || {};
    const baseURI = view.basedir || view.base || '';

    return Promise.resolve(types[type](modelConfig, baseURI, options));
});
