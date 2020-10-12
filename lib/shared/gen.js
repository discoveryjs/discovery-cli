const path = require('path');
const fs = require('fs');
const mime = require('mime');
const { runScript, DATA_PLACEHOLDER, MODE_PLACEHOLDER, SETUP_MODEL_PLACEHOLDER } = require('./utils');
const dataCommand = path.join(__dirname, '../../bin/data');
const staticCommand = path.join(__dirname, '../../bin/static');
const assetCommand = path.join(__dirname, '../../bin/asset');
const htmlDir = path.join(__dirname, '../static');

function escapeValueForHtml(value) {
    return String(value)
        .replace(/"/g, '&quot;')
        .replace(/&/g, '&amp;')
        .replace(/>/g, '&gt;');
}

function generateHtml(filepath, modelConfig, config) {
    const favicon = modelConfig.favicon || config.favicon;
    const viewport = modelConfig.viewport || config.viewport;
    const title = modelConfig.name || config.name;
    let html = fs.readFileSync(path.join(htmlDir, filepath), 'utf8');

    if (title) {
        html = html.replace(
            /<title>.*?<\/title>/,
            `<title>${title}</title>`
        );
    }

    if (viewport) {
        html = html.replace(
            /<meta name="viewport".*?>/,
            `<meta name="viewport" content="${escapeValueForHtml(viewport)}">`
        );
    }

    if (favicon) {
        html = html.replace(
            /<link rel="icon".*?>/,
            `<link rel="icon" type="${
                escapeValueForHtml(mime.getType(path.extname(favicon)))
            }" href="${
                escapeValueForHtml('favicon' + path.extname(favicon))
            }">`
        );
    }

    return Promise.resolve(html);
}

function generateModelAsset(type) {
    return (modelConfig = {}, options = {}) => {
        const { slug } = modelConfig;
        const args = [];

        if (options.configFile) {
            args.push(options.configFile);
        }

        if (options.es5LibsJs) {
            args.push('--es5-libs-js');
        }

        if (slug) {
            args.push('--model', slug);
        }

        args.push('--type', type);

        return runScript(assetCommand, args);
    };
}

function generateIndexAsset(type) {
    return (options = {}) => {
        const args = [];

        if (options.configFile) {
            args.push(options.configFile);
        }

        if (options.es5LibsJs) {
            args.push('--es5-libs-js');
        }

        args.push('--type', type);

        return runScript(assetCommand, args);
    };
}

function prepareModel({ name, slug, cache, meta, download }) {
    return {
        name,
        slug,
        cache: Boolean(cache),
        download,
        meta: meta || null
    };
}

module.exports = {
    '/gen/setup.js': function(modelConfig, options, config, data = 'data.json') {
        let setup = {
            name: config.name,
            mode: config.mode,
            isolateStyles: options.isolateStyles,
            data
        };

        if (modelConfig) {
            setup.model = prepareModel(modelConfig);
        } else {
            setup.models = Array.isArray(config.models) ? config.models.map(model => prepareModel(model)) : [];
        }

        return Promise.resolve('export default {' + Object.entries(setup).map(([key, origValue]) => {
            let value = JSON.stringify(origValue);

            if (key === 'mode') {
                value = `function ${MODE_PLACEHOLDER}(){return ${value}}()`;
            }

            if (key === 'model') {
                value = `function ${SETUP_MODEL_PLACEHOLDER}(){return ${value}}()`;
            }

            if (key === 'data') {
                value = `JSON.parse(function ${DATA_PLACEHOLDER}(){return ${options.singleFile ? 'null' : JSON.stringify(value)}}())`;
            }

            return `${key}:${value}`;
        }).join(',') + '}');
    },
    '/index.html': function(modelConfig, options, config) {
        return generateHtml('index.html', {}, config);
    },
    '/model-index.html': function(modelConfig, options, config) {
        return generateHtml('model.html', modelConfig, config);
    },
    '/data.json': function getData(modelConfig, options = {}) {
        const { slug } = modelConfig;
        const args = [];

        if (!slug) {
            return Promise.resolve('null');
        }

        args.push('--model', slug);

        if (options.configFile) {
            args.push('--config', options.configFile);
        }

        if (options.prettyData) {
            args.push('--pretty', JSON.stringify(options.prettyData));
        }

        return runScript(dataCommand, args);
    },
    '/gen/build.zip': (modelConfig, options) => {
        const { slug } = modelConfig;
        const args = [];

        if (!slug) {
            return Promise.resolve('null');
        }

        if (options.configFile) {
            args.push(options.configFile);
        }

        args.push('--model', slug);
        args.push('--dir', 'build');
        args.push('--cache', options.cache)

        return runScript(staticCommand, args);
    },
    '/gen/model-prepare.js': generateModelAsset('prepare'),
    '/gen/model-view.js': generateModelAsset('js'),
    '/gen/model-libs.js': generateModelAsset('libs-js'),
    '/gen/model-view.css': generateModelAsset('css'),
    '/gen/model-libs.css': generateModelAsset('libs-css'),
    '/gen/index-view.js': generateIndexAsset('index-js'),
    '/gen/index-libs.js': generateIndexAsset('index-libs-js'),
    '/gen/index-view.css': generateIndexAsset('index-css'),
    '/gen/index-libs.css': generateIndexAsset('index-libs-css')
};
