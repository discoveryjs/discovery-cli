const path = require('path');
const fs = require('fs');
const mime = require('mime');
const { stringifyStream }  = require('@discoveryjs/json-ext');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const gen = require('./shared/gen');
const ensureDir = require('./shared/ensure-dir');
const bundle = require('./shared/bundle');
const { createCacheDispatcher } = require('./shared/cache');
const decoder = new TextDecoder();

function relpath(pathname) {
    return path.relative(process.cwd(), pathname);
}

function decodeBytes(array) {
    return decoder.decode(array);
}

function writeFile(dest, content) {
    if (content.stream) {
        content = content.stream;
    }

    if (typeof content.pipe === 'function') {
        return new Promise((resolve, reject) =>
            content.pipe(fs.createWriteStream(ensureDir(dest)))
                .on('finish', resolve)
                .on('error', reject)
        ).then(() => utils.process(`Write ${relpath(dest)}`, () => {}));
    }

    return utils.process(`Write ${relpath(dest)}`, () => {
        fs.writeFileSync(ensureDir(dest), content);
    });
}

function injectData(data) {
    const flush = () => {
        res.push('\n<script>discoveryLoader.push(', JSON.stringify(buffer.join('')), ')</script>');
        bufferSize = 0;
        buffer = [];
    };
    const CHUNK_SIZE = 1024 * 1024;
    const res = [];
    let bufferSize = 0;
    let buffer = [];

    if (data === undefined) {
        return '';
    }

    return new Promise((resolve, reject) => stringifyStream(data.stream)
        .on('error', reject)
        .on('data', chunk => {
            bufferSize += chunk.length;
            buffer.push(chunk);

            if (bufferSize > CHUNK_SIZE) {
                flush();
            }
        })
        .on('end', () => {
            if (bufferSize > 0) {
                flush();
            }

            res.push('<script>discoveryLoader.finish()</script>');
            resolve(res.join(''));
        })
    );
}

async function convertToSingleFile(filepath, content, files) {
    const getFileContent = relpath => files.get(path.join(path.dirname(filepath), relpath));

    return (await content)
        .replace(/<link rel="icon".+?>/g, m => {
            utils.println('Inline', m);

            return m.replace(/\s+href="(.+?)"/, (m, faviconpath) =>
                ` href="data:${
                    mime.getType(path.extname(faviconpath))
                };base64,${
                    getFileContent(faviconpath).toString('base64')
                }"`
            );
        })
        .replace(/<link rel="stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inline', m) || `<style>${decodeBytes(getFileContent(hrefMatch[1]))}</style>`
                : m;
        })
        .replace(/<link rel="discovery-stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inject', m) || `<template src="${hrefMatch[1]}" style="display:none">${decodeBytes(getFileContent(hrefMatch[1]))}</template>`
                : m;
        })
        .replace(/<script .+?>/g, m => {
            let scriptSrc = null;
            const newOpenTag = m
                .replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''))
                .replace(/\s+type="module"/, '');

            return scriptSrc
                ? utils.println('Inline', m) || newOpenTag + decodeBytes(getFileContent(scriptSrc))
                : m;
        }) +
        (await injectData(getFileContent('data.json')));
}

module.exports = bootstrap(async function build(options, config, configFile) {
    const cacheDispatcher = createCacheDispatcher(config.models, { cachedir: options.cachedir });
    const outputDir = options.output;
    const outputFiles = new Map();
    const startTime = Date.now();
    const models = config.models || [];

    console.log(configFile
        ? `Load config from ${configFile}`
        : 'No config is used'
    );

    // check up models
    if (!models.length) {
        if (options.model) {
            // looks like a user mistake
            console.error(`  Model \`${options.model}\` is not found`);
            process.exit(2);
        }

        // model free mode
        utils.println('Models are not defined (model free mode is enabled)');

        config = {
            ...config,
            models: [{}]
        };
    }

    for (const modelConfig of models) {
        const favicon = modelConfig.favicon || config.favicon;

        outputFiles.set(
            `${modelConfig.slug}/index.html`,
            gen['/model.html'](modelConfig, options, config)
        );
        outputFiles.set(
            `${modelConfig.slug}/favicon${path.extname(favicon)}`,
            fs.readFileSync(favicon)
        );
    }

    if (config.mode === 'multi') {
        const favicon = config.favicon;

        outputFiles.set(
            'index.html',
            gen['/index.html'](null, options, config)
        );
        outputFiles.set(
            `favicon${path.extname(favicon)}`,
            fs.readFileSync(favicon)
        );
    }

    await utils.process('Build bundles', () => bundle(config, options).then(bundles => {
        for (const file of bundles.outputFiles) {
            const filepath = !/index(-loader)?\.(js|css)$/.test(file.path)
                ? file.path.replace(/(-loader)?\.(js|css)$/, '/model$&')
                : file.path;

            outputFiles.set(path.relative(outputDir, filepath), file.contents);
        }
    }));

    if (options.data) {
        await utils.section('Generate data', async () => {
            for (const modelConfig of models) {
                if (modelConfig.data) {
                    await utils.process(modelConfig.slug, async () => outputFiles.set(
                        `${modelConfig.slug}/data.json`,
                        await cacheDispatcher.read(modelConfig.slug).then(cache => cache
                            ? { stream: fs.createReadStream(cache.file) }
                            : gen['/data.json'](modelConfig, options)
                        )
                    ));
                } else {
                    utils.println('[NO DATA] ' + modelConfig.slug);
                }
            }
        });
    }

    if (options.singleFile) {
        await utils.section('Convert to single file', async () => {
            // make a copy of files since it may to be deleted before used for a substitution in html
            const files = new Map([...outputFiles.entries()]);

            for (const [path, content] of outputFiles) {
                if (/\.html$/.test(path)) {
                    outputFiles.set(path, await utils.section(path, () =>
                        convertToSingleFile(path, content, files)
                    ));
                } else {
                    outputFiles.delete(path);
                }
            }
        });
    }

    if (options.cleanup && fs.existsSync(options.output)) {
        await utils.process(`Clean up dest dir before write (${options.output})`, () =>
            fs.readdirSync(options.output).forEach(name => {
                const fullpath = path.join(options.output, name);

                if (fs.statSync(fullpath).isDirectory()) {
                    fs.rmdirSync(fullpath, { recursive: true });
                } else {
                    fs.unlinkSync(fullpath);
                }
            })
        );
    }

    await utils.process(`Write files to dest (${outputDir})`, () => utils.silent(() => Promise.all(
        [...outputFiles.keys()].sort().map(async filepath =>
            writeFile(path.resolve(outputDir, filepath), await outputFiles.get(filepath))
        )
    )));

    console.log(`\nDONE 🎉  (in ${utils.prettyDuration(Date.now() - startTime)})`);
});
