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

async function generateHtml(filepath, modelConfig, options, config) {
    const favicon = modelConfig?.favicon || config.favicon;
    const viewport = modelConfig?.viewport || config.viewport;
    const title = modelConfig?.name || config.name;
    const noscript = modelConfig ? modelConfig.view.noscript : config.view.noscript;
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

    if (noscript || !modelConfig) {
        const { slug } = modelConfig || {};
        const args = [];

        if (options.configFile) {
            args.push('--config', options.configFile);
        }

        if (slug) {
            args.push('--model', slug);
        }

        const noscriptContent = await runScript(command.noscript, args);

        html = /<noscript type=(["']?)discovery-noscript\1/.test(html)
            ? html.replace(/(<noscript type=(["']?)discovery-noscript\2[^>]*>).*<\/noscript>/s, (_, open) => `${open}\n${noscriptContent}\n</noscript>`)
            : html.replace(/<body[^>]*?>(\s+)/s, (m, nl) => m + `<noscript>${noscriptContent}</noscript>` + nl);
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
        slug,
        name,
        version,
        description,
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
        slug,
        name,
        version,
        description,
        url: entryName,
        data: modelConfig.data
            ? buildAssetNameByPattern(undefined, entryName, { slug, name: 'data', ext: 'json'})
            : null,
        cache: Boolean(cache),
        cacheReset: Boolean(cacheReset),
        upload: options.modelDataUpload ? upload : false,
        download: options.modelDownload ? download : false,
        embed: embedOption(options, modelConfig),
        darkmode,
        darkmodePersistent: true,
        inspector,
        router,
        meta: meta || null
    };
}

async function genSetupJson(modelConfig, options, config, cacheDispatcher) {
    let setup = {
        name: config.name,
        version: config.version,
        description: config.description,
        mode: config.mode,
        embed: embedOption(options, modelConfig || config),
        inspector: Boolean(config.view?.inspector),
        router: Boolean(config.view?.router),
        darkmode: config.darkmode,
        darkmodePersistent: true
    };

    if (modelConfig) {
        const slug = modelConfig.slug;
        const model = prepareModel(modelConfig, options, cacheDispatcher);
        const entryName = model.url;

        setup.model = model;
        setup.indexUrl = path.relative(entryName, 'index.html');
        setup.assets = options.singleFile
            ? {
                'model.css': 'model.css',
                'model-loader.css': 'model-loader.css'
            }
            : {
                'model.css': buildAssetNameByPattern(undefined, entryName, { slug, name: 'model', ext: 'css'}),
                'model-loader.css': buildAssetNameByPattern(undefined, entryName, { slug, name: 'model-loader', ext: 'css'})
            };
    } else {
        setup.models = Array.isArray(config.models)
            ? config.models.map(modelConfig => prepareModel(modelConfig, options, cacheDispatcher))
            : [];
    }

    return JSON.stringify(setup);
}

module.exports = {
    '/setup.json': genSetupJson,
    '/setup.js': async function(modelConfig, options, config, cacheDispatcher) {
        return `const setup = ${await genSetupJson(modelConfig, options, config, cacheDispatcher)};
            if (!location.pathname.endsWith('.html')) {
                if (setup.model) {
                    setup.indexUrl = setup.indexUrl.replace(/^\\.\\.\\/|index\\.html$/g, '');
                }
                if (setup.models) {
                    for (const model of setup.models) {
                        model.url = model.url.replace(/(^|\\/|\\\\)index\\.html$/, '$1');
                    }
                }
            }
            export default setup;
        `;
    },
    '/index.html': function(modelConfig, options, config) {
        return generateHtml('index.html', modelConfig, options, config);
    },
    '/model.html': function(modelConfig, options, config) {
        return generateHtml('model.html', modelConfig, options, config);
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

        if (options.experimentalJsonxl) {
            args.push('--experimental-jsonxl');
        }

        return runScript(command.data, args);
    }
};
