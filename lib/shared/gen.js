const path = require('path');
const fs = require('fs');
const mime = require('mime');
const { runScript, buildEntryNameByPattern, buildAssetNameByPattern } = require('./utils');
const command = require('./commands');
const htmlDir = path.join(__dirname, '../static');

function escapeValueForHtml(value) {
    return String(value)
        .replace(/"/g, '&quot;')
        .replace(/&/g, '&amp;')
        .replace(/>/g, '&gt;');
}

async function generateHtml(filepath, modelConfig, config) {
    const favicon = modelConfig.favicon || config.favicon;
    const viewport = modelConfig.viewport || config.viewport;
    const title = modelConfig.name || config.name;
    let html = await fs.promises.readFile(path.join(htmlDir, filepath), 'utf8');

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

    return html;
}

function embedOption(options, modelConfig) {
    return options.embed === 'enable'
        ? true
        : options.embed === 'disable'
            ? false
            : modelConfig?.embed;
}

function prepareModel(modelConfig, options, cacheDispatcher) {
    const {
        name,
        slug,
        meta,
        upload,
        download,
        darkmode,
        view
    } = modelConfig;
    const {
        cache,
        manualReset: cacheReset
    } = cacheDispatcher.getModelCacheInfo(slug);
    const {
        inspector,
        router
    } = view || {};
    const entryName = buildEntryNameByPattern(options.entryNames, { slug });

    return {
        name,
        slug,
        url: entryName,
        cache: Boolean(cache),
        cacheReset,
        upload: options.modelDataUpload ? upload : false,
        download: options.modelDownload ? download : false,
        embed: embedOption(options, modelConfig),
        darkmode,
        inspector,
        router,
        meta: meta || null
    };
}

module.exports = {
    '/setup.js': function(modelConfig, options, config, cacheDispatcher) {
        let setup = {
            name: config.name,
            mode: config.mode,
            embed: embedOption(options, modelConfig || config),
            darkmode: config.darkmode
        };

        if (modelConfig) {
            const slug = modelConfig.slug;
            const model = prepareModel(modelConfig, options, cacheDispatcher);
            const entryName = model.url;

            setup.model = model;
            setup.data = modelConfig.data
                ? buildAssetNameByPattern(undefined, entryName, { slug, name: 'data', ext: 'json'})
                : null;
            setup.indexUrl = path.relative(entryName, 'index.html');
            console.log(entryName, 'index.html', setup.indexUrl);
            setup.assets = options.singleFile
                ? {
                    'model.js': './model.js',
                    'model.css': 'model.css',
                    'model-loader.css': 'model-loader.css'
                }
                : {
                    'model.js': buildAssetNameByPattern(undefined, entryName, { slug, name: 'model', ext: 'js'}),
                    'model.css': buildAssetNameByPattern(undefined, entryName, { slug, name: 'model', ext: 'css'}),
                    'model-loader.css': buildAssetNameByPattern(undefined, entryName, { slug, name: 'model-loader', ext: 'css'})
                };
        } else {
            setup.models = Array.isArray(config.models)
                ? config.models.map(modelConfig => prepareModel(modelConfig, options, cacheDispatcher))
                : [];
        }

        return Promise.resolve(`const setup = ${JSON.stringify(setup)};
            const isHtml = location.pathname.endsWith('.html');
            if (setup.model) {
                setup.assets['model.js'] = (isHtml ? '../' : './') + setup.assets['model.js'];
                if (!isHtml) {
                    setup.indexUrl = setup.indexUrl.replace(/^\\.\\.\\/|index\\.html$/g, '');
                }
            }
            if (setup.models && !isHtml) {
                for (const model of setup.models) {
                    model.url = model.url.replace(/(^|\\/|\\\\)index\\.html$/, '$1');
                }
            }
            export default setup;
        `);
    },
    '/index.html': function(modelConfig, options, config) {
        return generateHtml('index.html', {}, config);
    },
    '/model.html': function(modelConfig, options, config) {
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

        return runScript(command.data, args);
    }
};
