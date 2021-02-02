const path = require('path');
const fs = require('fs');
const mime = require('mime');
const { runScript } = require('./utils');
const dataCommand = path.join(__dirname, '../../bin/data');
const staticCommand = path.join(__dirname, '../../bin/static');
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

function prepareModel({ name, slug, cache, meta, download, darkmode }) {
    return {
        name,
        slug,
        cache: Boolean(cache),
        download,
        darkmode,
        meta: meta || null
    };
}

module.exports = {
    '/gen/setup.js': function(modelConfig, options, config, data = 'data.json') {
        let setup = {
            name: config.name,
            mode: config.mode,
            darkmode: config.darkmode,
            data
        };

        if (modelConfig) {
            setup.model = prepareModel(modelConfig);
        } else {
            setup.models = Array.isArray(config.models) ? config.models.map(model => prepareModel(model)) : [];
        }

        return Promise.resolve('export default ' + JSON.stringify(setup));
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
        args.push('--cachedir', options.cachedir);

        return runScript(staticCommand, args);
    }
};
