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
        .then((data) =>
            gen['/gen/setup.js'](modelConfig, options, config, data)
                .then(content => writeFile(pathResolver('/gen/setup.js'), content))
        )
        .then(async () => {
            const filename = pathResolver(jsFilename);
            const { outputFiles } = await timeOp(
                'Build JS bundle',
                () => bundleJs(filename, jsBundleOptions)
            );

            writeFile(filename, outputFiles[0].contents);
        })
    );
}

function createModel(pathResolver, modelConfig, options, config, jsBundleOptions, cssBundleOptions, cacheDispatcher) {
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

    return Promise
        .all(
            [
                '/gen/lib.js',
                '/gen/lib.css',
                '/gen/model-prepare.js',
                '/gen/model-view.js',
                '/gen/model-libs.js',
                '/gen/model-view.css',
                '/gen/model-libs.css'
            ].map(filename =>
                gen[filename](modelConfig, options)
                    .then(content => writeFile(pathResolver(filename), content))
            )
        )
        .then(() =>
            gen['/model-index.html'](modelConfig, options, config)
                .then(content => writeFile(pathResolver('index.html'), content))
        )
        .then(() =>
            makeBundles(
                pathResolver,
                options.prebuild ? modelConfig : { ...modelConfig, download: false, cache: false },
                options,
                config,
                'model.js',
                jsBundleOptions,
                'model.css',
                cssBundleOptions,
                cacheDispatcher
            )
        )
        .then(() => options.singleFile && utils.section('Convert to single page', () => {
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
        }))
        .then(() => utils.section('Clean up', () => {
            rm(pathResolver('gen'));

            if (options.singleFile) {
                [
                    favicon,
                    'data.json',
                    'model.css',
                    'model.js'
                ].forEach(filepath => rm(pathResolver(filepath)));
            }
        }));
}

function copyCommonFiles(dest, config) {
    utils.section('Copy common files', () => {
        [
            config.favicon || path.join(discoverySrc, 'favicon.png'),
            path.join(staticSrc, 'common.css')
        ].forEach(
            filename => copyFile(filename, dest)
        );
        // copyFileIfExists(path.join(discoveryDir, 'dist/lib.js'), dest, 'dist/lib.js');
        // copyFileIfExists(path.join(discoveryDir, 'dist/discovery.raw.css'), dest, 'src/lib.css');
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

module.exports = bootstrap(function build(options, config, configFile) {
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

    options.es5LibsJs = true;

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

        pipeline = pipeline
            .then(() =>
                copyCommonFiles(tmpdir, config)
            )
            .then(() =>
                createModel(
                    createPathResolver(tmpPath('modelfree')),
                    {},
                    options,
                    config,
                    jsBundleOptions,
                    null,
                    cacheDispatcher
                )
            )
            .then(() => cleanupDestDir(options))
            .then(() => utils.section(`Copy files to dest (${outputDir})`, () =>
                copyDirContent(tmpPath('modelfree'), outputDir)
            ))
            .then(() => done(startTime));
    } else {
        const model = options.model || config.mode === 'single' && config.models[0].slug || false;

        cleanupTempDir();
        copyCommonFiles(tmpdir, config);

        pipeline = pipeline.then(() => utils.section('Build models', () =>
            config.models.reduce(
                (pipeline, modelConfig) =>
                    pipeline.then(() => utils.section(modelConfig.slug, () =>
                        createModel(
                            createPathResolver(tmpPath(modelConfig.slug)),
                            modelConfig,
                            options,
                            config,
                            jsBundleOptions,
                            cssBundleOptions,
                            cacheDispatcher
                        )
                    )),
                Promise.resolve()
            )
        ));

        if (config.mode === 'multi') {
            copyFile(path.join(staticSrc, 'index.js'), tmpdir);
            replacePathToDiscovery(tmpPath('index.js'));

            copyFile(path.join(staticSrc, 'index.css'), tmpdir);
            replacePathToDiscovery(tmpPath('index.css'));

            copyFile(path.join(discoverySrc, 'logo.svg'), tmpdir);

            pipeline = pipeline.then(() => Promise.all(
                [
                    '/gen/index-view.js',
                    '/gen/index-libs.js',
                    '/gen/index-view.css',
                    '/gen/index-libs.css'
                ].map(filename =>
                    gen[filename](options)
                        .then(content => writeFile(tmpPath(filename), content))
                )
            ));
            pipeline = pipeline.then(() =>
                gen['/index.html'](null, options, config)
                    .then(content => writeFile(tmpPath('/index.html'), content))
            );
            pipeline = pipeline.then(() =>
                makeBundles(
                    tmpPath,
                    null,
                    options,
                    config,
                    'index.js',
                    jsBundleOptions,
                    'index.css',
                    cssBundleOptions,
                    cacheDispatcher
                )
            );
        }

        pipeline = pipeline.then(() =>
            utils.section('Clean up', () => {
                [
                    'gen',
                    'common.css',
                    'lib.css',
                    'lib.js',
                    'logo.svg'
                ].forEach(path => rm(tmpPath(path)));
            })
        );

        pipeline = pipeline.then(() => cleanupDestDir(options));
        pipeline = pipeline.then(() => utils.section(`Copy files to dest (${outputDir})`, () => {
            copyDirContent(tmpPath(model || ''), outputDir);
        }));

        pipeline.then(() => done(startTime));
    }

    return pipeline;
});

module.exports.bundleCss = bundleCss;
module.exports.bundleJs = bundleJs;
