const path = require('path');
const fs = require('fs');
const mime = require('mime');
const { pipeline } = require('stream');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const gen = require('./shared/gen');
const ensureDir = require('./shared/ensure-dir');
const bundle = require('./shared/bundle');
const { createCacheDispatcher } = require('./shared/cache');
const ChunkedContent = require('./shared/chunked-content');
const createHtmlDataPrinter = require('./shared/html-data-printer');

function relpath(pathname) {
    return path.relative(process.cwd(), pathname);
}

function writeFile(dest, content) {
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

function createHtmlDiscoveryDataPrinter(maxChunkSize) {
    return createHtmlDataPrinter(
        maxChunkSize,
        // type
        'discovery/data-chunk',
        // onDataChunk
        'discoveryLoader.push(chunk)',
        // onFinish
        'discoveryLoader.finish()'
    );
}

function streamDataToHtml(data) {
    if (!data) {
        return '';
    }

    return pipeline(
        data,
        async function* (source) {
            const size = 1024 * 1024;
            const printer = createHtmlDiscoveryDataPrinter(size);

            source.setEncoding('utf8'); // work with strings rather than `Buffer`s

            for await (const chunk of source) {
                for (const x of printer.push(chunk)) {
                    yield x;
                }
            }

            for (const x of printer.finish()) {
                yield x;
            }
        },
        function() {
            // Pipeline() expects a callback as the last parameter, doesn't work otherwise
            // console.log('ok', filepath, Date.now() - t);
        }
    );
}

async function convertToSingleFile(filepath, content, files) {
    const getFileContent = relpath => files.get(path.join(path.dirname(filepath), relpath));

    return new ChunkedContent(await content)
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
                ? utils.println('Inline', m) || ['<style>', getFileContent(hrefMatch[1]), '</style>`']
                : m;
        })
        .replace(/<link rel="discovery-stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inject', m) || [`<style type="discovery/style" src="${hrefMatch[1]}">`, getFileContent(hrefMatch[1]), '</style>']
                : m;
        })
        .replace(/<script .+?>/g, m => {
            let scriptSrc = null;
            const newOpenTag = m
                .replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''))
                .replace(/\s+type="module"/, '');

            return scriptSrc
                ? utils.println('Inline', m) || [newOpenTag, getFileContent(scriptSrc)]
                : m;
        })
        .replace(/$/, () =>
            streamDataToHtml(getFileContent('data.json'))
        );
}

async function build(options, config, configFile) {
    const cacheDispatcher = createCacheDispatcher(config.models, { configFile, ...options });
    const outputDir = options.output;
    const outputFiles = new Map();
    const models = config.models || [];

    utils.println(configFile
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

        models.push({ slug: 'modelfree' });
        config = {
            ...config,
            models: models
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

    await utils.process('Build bundles', () => bundle(config, options, null, { cacheDispatcher }).then(result => {
        for (const file of result.outputFiles) {
            outputFiles.set(path.relative(outputDir, file.path), Buffer.from(file.contents));
        }
    }));

    if (options.data) {
        await utils.section('Generate data', async () => {
            for (const modelConfig of models) {
                if (modelConfig.data) {
                    await utils.process(modelConfig.slug, async () => outputFiles.set(
                        `${modelConfig.slug}/data.json`,
                        await cacheDispatcher.read(modelConfig.slug)
                            .then(cache => cache
                                ? { stream: fs.createReadStream(cache.file) }
                                : gen['/data.json'](modelConfig, options)
                            )
                            .then(res => res.stream)
                    ));
                } else {
                    utils.println(`${modelConfig.slug} <no data>`);
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

    if (options.clean && fs.existsSync(options.output)) {
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

    if (config.mode === 'modelfree' || config.mode === 'single') {
        const pattern = new RegExp('^' + models[0].slug + '/');
        for (const [key, value] of outputFiles) {
            if (pattern.test(key)) {
                outputFiles.delete(key);
                outputFiles.set(key.replace(pattern, ''), value);
            }
        }
    }

    return outputFiles;
}

module.exports = bootstrap(async function(options, config, configFile) {
    const startTime = Date.now();
    const outputDir = options.output;
    const outputFiles = await build(options, config, configFile);

    await utils.process(`Write files to dest (${outputDir})`, () => utils.silent(() => Promise.all(
        [...outputFiles.keys()].sort().map(async filepath =>
            writeFile(path.resolve(outputDir, filepath), await outputFiles.get(filepath))
        )
    )));

    console.log(`\nDONE 🎉  (in ${utils.prettyDuration(Date.now() - startTime)})`);
});

module.exports.build = build;
