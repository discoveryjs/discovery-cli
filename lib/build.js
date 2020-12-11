const path = require('path');
const fs = require('fs');
const mime = require('mime');
const bundleJs = require('./shared/bundle-js');
const bundleCss = require('./shared/bundle-css');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const gen = require('./shared/gen');
const ensureDir = require('./shared/ensure-dir');
const discoveryDir = require('./shared/discovery-dir');
const { createCacheDispatcher } = require('./shared/cache');
const tmpdir = path.join(__dirname, '../tmp'); // fs.realpathSync(os.tmpdir())
const discoverySrc = path.join(discoveryDir, 'src');
const staticSrc = path.join(__dirname, 'static');

function createPathResolver(dir) {
    return filename => path.join(dir, filename || '');
}

function isRelatedToPath(pathname, dir, name) {
    return pathname.slice(0, dir.length) === dir
        ? `(${name})${pathname.slice(dir.length + 1)}`
        : false;
}

function relpath(pathname) {
    return (
        isRelatedToPath(pathname, discoveryDir, 'discovery') ||
        isRelatedToPath(pathname, tmpdir, 'temp') ||
        path.relative(process.cwd(), pathname)
    );
}

function scanFs(pathname, fn, includeDir) {
    if (!fs.existsSync(pathname)) {
        return;
    }

    if (fs.statSync(pathname).isDirectory()) {
        fs.readdirSync(pathname).forEach(relpath =>
            scanFs(path.join(pathname, relpath), fn, includeDir)
        );

        if (includeDir) {
            fn(pathname, true);
        }
    } else {
        fn(pathname, false);
    }
}

function rm(pathname) {
    scanFs(pathname, (pathname, isDir) => {
        utils.println(`Delete ${relpath(pathname)}`);

        if (isDir) {
            fs.rmdirSync(pathname);
        } else {
            fs.unlinkSync(pathname);
        }
    }, true);
}

function copyFile(filename, destDir, newFilename) {
    const src = filename;
    const dest = path.join(destDir, newFilename || path.basename(filename));

    utils.process(`Copy ${relpath(src)} → ${relpath(dest)}`, () =>
        fs.copyFileSync(src, ensureDir(dest))
    );
}

function copyFileIfExists(filename, destDir, newFilename) {
    if (fs.existsSync(filename)) {
        copyFile(filename, destDir, newFilename);
    }
}

function copyDirContent(dir, dest) {
    fs.readdirSync(dir).forEach(filepath =>
        scanFs(path.join(dir, filepath), filepath =>
            copyFile(filepath, path.dirname(path.join(dest, path.relative(dir, filepath))))
        )
    );
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(filepath =>
            rm(path.join(dir, filepath))
        );
    }
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
        fs.writeFileSync(ensureDir(dest), content, 'utf8');
    });
}

function replacePathToDiscovery(pathname) {
    fs.writeFileSync(
        pathname,
        fs.readFileSync(pathname, 'utf8').replace(/@discoveryjs\/discovery\//g, ''),
        'utf8'
    );
}

function timeOp(label, task) {
    const startTime = Date.now();

    return task().then(result => {
        utils.println(label, `(${utils.prettyDuration(Date.now() - startTime)})`);
        return result;
    });
}

function selectAssets(modelConfig) {
    const view = modelConfig.view || {};
    const baseURI = view.basedir || view.base || '';

    return Array.isArray(view.assets)
        ? view.assets.map(fn => path.resolve(baseURI, fn))
        : [];
}

function makeBundles(pathResolver, modelConfig, options, config, jsFilename, jsBundleOptions, cssFilename, cssBundleOptions, cacheDispatcher) {
    return utils.section('Build bundles', () => Promise.resolve()
        .then(async () => {
            const filename = pathResolver(cssFilename);
            const { isolate, content } = await timeOp(
                'Build CSS bundle',
                () => bundleCss(filename, cssBundleOptions)
            );

            writeFile(filename, content);
            options = {
                ...options,
                isolateStyles: isolate
            };
        })
        .then(async () => {
            if (!modelConfig || !config.models || !config.models.length) {
                return null;
            }

            if (!options.data) {
                return;
            }

            let genData = cacheDispatcher.read(modelConfig.slug)
                .then(cache => {
                    if (!cache) {
                        return gen['/data.json'](modelConfig, options);
                    }

                    return {
                        stream: fs.createReadStream(cache.file)
                    };
                });

            return genData.then(content => writeFile(pathResolver('data.json'), content));
        })
        .then(async (data) => {
            const filename = pathResolver(jsFilename);
            const { content } = await timeOp(
                'Build JS bundle',
                () => bundleJs(filename, {
                    setup() {
                        return gen['/gen/setup.js'](modelConfig, options, config, data);
                    },
                    prepare() {
                        return modelConfig.prepare
                            ? 'require(' + JSON.stringify(modelConfig.prepare) + ');'
                            : '';
                    },
                    extensions() {
                        return 'return [' + selectAssets(modelConfig)
                            .filter(fn => /\.[tj]sx?/.test(path.extname(fn)))
                            .map(fn => 'require(' + JSON.stringify(fn) + ')')
                            .join(',') + ']';
                    }
                }, jsBundleOptions)
            );

            writeFile(filename, content);
        })
    );
}

async function createModel(pathResolver, modelConfig, options, config, jsBundleOptions, cssBundleOptions, cacheDispatcher) {
    const startTime = Date.now();
    const favicon = '/favicon' + path.extname(modelConfig.favicon || config.favicon);

    ['model.js', 'model.css'].forEach(filename => {
        copyFile(path.join(staticSrc, filename), pathResolver(), filename);
        replacePathToDiscovery(pathResolver(filename));
    });

    // favicon
    copyFile(
        modelConfig.favicon || config.favicon,
        pathResolver(),
        favicon
    );

    // /gen/extensions.css
    await writeFile(pathResolver('/gen/extensions.css'), selectAssets(modelConfig)
        .filter(fn => path.extname(fn) === '.css')
        .map(fn => '@import url(' + JSON.stringify(fn) + ');')
        .join('\n')
    );

    writeFile(
        pathResolver('index.html'),
        await gen['/model-index.html'](modelConfig, options, config)
    );

    await makeBundles(
        pathResolver,
        options.prebuild ? modelConfig : { ...modelConfig, download: false, cache: false },
        options,
        config,
        'model.js',
        jsBundleOptions,
        'model.css',
        cssBundleOptions,
        cacheDispatcher
    );

    if (options.singleFile) {
        utils.section('Convert to single page', () => {
            fs.writeFileSync(
                pathResolver('index.html'),
                fs.readFileSync(pathResolver('index.html'), 'utf8')
                    .replace(/<link rel="icon".+?>/g, m => {
                        utils.println('Inline', m);
                        return m.replace(/\s+href="(.+?)"/, (m, filepath) =>
                            ` href="data:${
                                mime.getType(path.extname(filepath))
                            };base64,${
                                fs.readFileSync(pathResolver(filepath), 'base64')
                            }"`
                        );
                    })
                    .replace(/<link rel="stylesheet".+?>/g, m => {
                        const hrefMatch = m.match(/\s+href="(.+?)"/);

                        return hrefMatch
                            ? utils.println('Inline', m) || `<style>${fs.readFileSync(pathResolver(hrefMatch[1]), 'utf8')}</style>`
                            : m;
                    })
                    .replace(/<script .+?>/g, m => {
                        let scriptSrc = null;
                        const newOpenTag = m.replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''));

                        return scriptSrc
                            ? utils.println('Inline', m) || newOpenTag + fs.readFileSync(pathResolver(scriptSrc), 'utf8')
                            : m;
                    })
                    .replace(new RegExp(`function ${utils.DATA_PLACEHOLDER}\\(\\){return.*?}\\(\\)`), () => {
                        utils.println('Substitute data');
                        return JSON.stringify(fs.readFileSync(pathResolver('data.json'), 'utf8'));
                    }),
                'utf8'
            );
        });
    }

    utils.section('Clean up', () => {
        rm(pathResolver('gen'));

        if (options.singleFile) {
            [
                favicon,
                'data.json',
                'model.css',
                'model.js'
            ].forEach(filepath => rm(pathResolver(filepath)));
        }
    });

    console.log(Date.now() - startTime);
}

function copyCommonFiles(dest, config) {
    utils.section('Copy common files', () => {
        [
            config.favicon || path.join(discoverySrc, 'favicon.png'),
            path.join(staticSrc, 'common.css')
        ].forEach(
            filename => copyFile(filename, dest)
        );

        copyFileIfExists(path.join(discoveryDir, 'dist/discovery.raw.css'), dest, 'lib.css');
    });
}

function cleanupTempDir() {
    utils.section('Clean up temp dir', () => cleanDir(tmpdir));
}

function cleanupDestDir(options) {
    if (options.cleanup) {
        utils.section(`Clean up dest dir before write (${options.output})`, () =>
            cleanDir(options.output)
        );
    }
}

function done(startTime) {
    console.log(`\nDONE 🎉  (in ${utils.prettyDuration(Date.now() - startTime)})`);
}

module.exports = bootstrap(async function build(options, config, configFile) {
    const cacheDispatcher = createCacheDispatcher(config.models, { cachedir: options.cachedir });
    const outputDir = options.output;
    const tmpPath = createPathResolver(tmpdir);
    const startTime = Date.now();
    const cssBundleOptions = {
        isolate: options.isolateStyles
    };
    const jsBundleOptions = {
        minify: true
    };
    let pipeline = Promise.resolve();

    console.log(configFile
        ? `Load config from ${configFile}`
        : 'No config is used'
    );

    // check up models
    if (!config.models || !config.models.length) {
        if (options.model) {
            // looks like a user mistake
            console.error(`  Model \`${options.model}\` is not found`);
            process.exit(2);
        }

        // model free mode
        utils.println('Models are not defined (model free mode is enabled)');

        cleanupTempDir();

        await copyCommonFiles(tmpdir, config);
        await createModel(
            createPathResolver(tmpPath('modelfree')),
            {},
            options,
            config,
            jsBundleOptions,
            null,
            cacheDispatcher
        );
        await cleanupDestDir(options);
        await utils.section(`Copy files to dest (${outputDir})`, () =>
            copyDirContent(tmpPath('modelfree'), outputDir)
        );

        done(startTime);
    } else {
        const model = options.model || config.mode === 'single' && config.models[0].slug || false;

        cleanupTempDir();
        copyCommonFiles(tmpdir, config);

        await utils.section('Build models', async () => {
            for (const modelConfig of config.models) {
                await utils.section(modelConfig.slug, () =>
                    createModel(
                        createPathResolver(tmpPath(modelConfig.slug)),
                        modelConfig,
                        options,
                        config,
                        jsBundleOptions,
                        cssBundleOptions,
                        cacheDispatcher
                    )
                );
            }
        });

        if (config.mode === 'multi') {
            copyFile(path.join(staticSrc, 'index.js'), tmpdir);
            replacePathToDiscovery(tmpPath('index.js'));

            copyFile(path.join(staticSrc, 'index.css'), tmpdir);
            replacePathToDiscovery(tmpPath('index.css'));

            copyFile(path.join(discoverySrc, 'logo.svg'), tmpdir);

            await writeFile(tmpPath('/gen/extensions.css'), '');
            await writeFile(tmpPath('/gen/extensions.js'), '');
            await writeFile(tmpPath('/index.html'), await gen['/index.html'](null, options, config));

            await makeBundles(
                tmpPath,
                null,
                options,
                config,
                'index.js',
                jsBundleOptions,
                'index.css',
                cssBundleOptions,
                cacheDispatcher
            );
        }

        await utils.section('Clean up', () => [
            'gen',
            'common.css',
            'lib.css',
            'lib.js',
            'logo.svg'
        ].forEach(path => rm(tmpPath(path))));

        await cleanupDestDir(options);
        await utils.section(`Copy files to dest (${outputDir})`, () =>
            copyDirContent(tmpPath(model || ''), outputDir)
        );

        done(startTime);
    }
});

module.exports.bundleCss = bundleCss;
module.exports.bundleJs = bundleJs;
