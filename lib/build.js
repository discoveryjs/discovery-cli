const path = require('path');
const fs = require('fs');
const mime = require('mime');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const gen = require('./shared/gen');
const ensureDir = require('./shared/ensure-dir');
const bundle = require('./shared/bundle');
const { createCacheDispatcher } = require('./shared/cache');

function relpath(pathname) {
    return path.relative(process.cwd(), pathname);
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

function convertToSingleFile(filepath, content, files) {
    const getFileContent = relpath => files.get(path.resolve(path.dirname(filepath), relpath));

    return content
        .replace(/<link rel="icon".+?>/g, m => {
            utils.println('Inline', m);
            return m.replace(/\s+href="(.+?)"/, (m, filepath) =>
                ` href="data:${
                    mime.getType(path.extname(filepath))
                };base64,${
                    getFileContent(filepath)
                }"`
            );
        })
        .replace(/<link rel="stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inline', m) || `<style>${getFileContent(hrefMatch[1])}</style>`
                : m;
        })
        .replace(/<script .+?>/g, m => {
            let scriptSrc = null;
            const newOpenTag = m.replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''));

            return scriptSrc
                ? utils.println('Inline', m) || newOpenTag + getFileContent(scriptSrc)
                : m;
        })
        .replace(new RegExp(`function ${utils.DATA_PLACEHOLDER}\\(\\){return.*?}\\(\\)`), () => {
            utils.println('Substitute data');
            return JSON.stringify(getFileContent('data.json'));
        });
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
        outputFiles.set(
            'index.html',
            gen['/index.html'](null, options, config)
        );
    }

    await utils.process('Build bundles', () => bundle(config, options).then(bundles => {
        for (const file of bundles.outputFiles) {
            const filepath = !/index\.(js|css)$/.test(file.path)
                ? file.path.replace(/\.(js|css)$/, '/model$&')
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
        await utils.process('Convert to single file', () => {
            const files = new Map([...outputFiles.entries()]);

            for (const [path, content] of files) {
                if (/\.html$/.test(path)) {
                    convertToSingleFile(path, content, files);
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
                    fs.rmdirSync(fullpath);
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
