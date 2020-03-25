const path = require('path');
const fs = require('fs');
const mime = require('mime');
const { fork } = require('child_process');
const dataCommand = path.join(__dirname, '../../bin/data');
const assetCommand = path.join(__dirname, '../../bin/asset');
const htmlDir = path.join(__dirname, '../static');

function runScript(command, args) {
    return new Promise((resolve, reject) => {
        const stderr = [];
        const child = fork(command, args, { stdio: ['inherit', 'inherit', 'pipe', 'ipc'] });

        child.stderr
            .on('data', chunk => {
                stderr.push(chunk);
                process.stderr.write(chunk);
            });
        child
            .on('message', resolve)
            .on('close', code => {
                const error = stderr.join('');

                if (error || code) {
                    reject(error || 'Process exit with code ' + code);
                }
            });
    });
}

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

function prepareModel({ name, slug, cache }) {
    return {
        name,
        slug,
        cache: Boolean(cache)
    };
}

module.exports = {
    '/gen/setup.js': function(modelConfig, options, config) {
        let data = {
            name: config.name,
            mode: config.mode,
            isolateStyles: options.isolateStyles
        };

        if (modelConfig) {
            data.model = prepareModel(modelConfig);
        } else {
            data.models = Array.isArray(config.models) ? config.models.map(model => prepareModel(model)) : [];
        }

        return Promise.resolve('export default ' + JSON.stringify(data));
    },
    '/index.html': function(modelConfig, options, config) {
        return generateHtml('index.html', {}, config);
    },
    '/model-index.html': function(modelConfig, options, config) {
        return generateHtml('model.html', modelConfig, config);
    },
    '/data.json': function(modelConfig, options = {}) {
        const { slug } = modelConfig;
        const args = [];

        if (!slug) {
            return Promise.resolve('null');
        }

        if (options.configFile) {
            args.push(options.configFile);
        }

        if (options.cache) {
            args.push('--cache');
            if (typeof options.cache === 'string') {
                args.push(options.cache);
            }
        }

        if (options.rewriteCache) {
            args.push('--rewrite-cache');
        }

        if (options.prettyData) {
            args.push('--pretty');
            if (typeof options.prettyData === 'number') {
                args.push(options.prettyData);
            }
        }

        args.push('--model', slug);

        return runScript(dataCommand, args);
    },
    '/gen/model-prepare.js': generateModelAsset('prepare'),
    '/gen/model-view.js': generateModelAsset('js'),
    '/gen/model-libs.js': generateModelAsset('libs-js'),
    '/gen/model-view.css': generateModelAsset('css'),
    '/gen/model-libs.css': generateModelAsset('libs-css')
};
